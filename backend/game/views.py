from django.db.models import Q
from django.shortcuts import render
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .engine import calculate_cube_move, calculate_proto_tank_bullets, calculate_proto_tank_move
from .models import FriendRequest, Arena, Lobby, LobbyInvite, LobbyPlayer, PlayerProfile, Tank
from .serializers import (
    ArenaSerializer,
    FriendPlayerSerializer,
    FriendRequestSerializer,
    FriendsSummarySerializer,
    LobbyCreateSerializer,
    LobbyInviteSerializer,
    LobbySerializer,
    LobbySideSerializer,
    LobbyStatusSerializer,
    PasswordChangeSerializer,
    PlayerProfileSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    SelectTankSerializer,
    TankSerializer,
)


def test_game_view(request):
    return render(request, 'game/test_game.html')


class TankViewSet(viewsets.ModelViewSet):
    queryset = Tank.objects.all()
    serializer_class = TankSerializer
    permission_classes = [IsAuthenticated]


class ArenaList(generics.ListCreateAPIView):
    queryset = Arena.objects.all()
    serializer_class = ArenaSerializer
    permission_classes = [IsAuthenticated]


def _touch_profile(profile: PlayerProfile):
    profile.lastSeenAt = timezone.now()
    profile.save(update_fields=['lastSeenAt'])
    return profile


def _get_or_create_profile(user):
    profile, _ = PlayerProfile.objects.get_or_create(
        user=user,
        defaults={'nickname': user.username or f'Player_{user.id}', 'lastSeenAt': timezone.now()},
    )
    if not profile.nickname:
        profile.nickname = user.username or f'Player_{user.id}'
        profile.save(update_fields=['nickname'])
    return _touch_profile(profile)


def _serialize_lobby(lobby):
    return LobbySerializer(lobby).data


def _ensure_lobby_membership(lobby, profile, side='allies'):
    member, created = LobbyPlayer.objects.get_or_create(
        lobby=lobby,
        player=profile,
        defaults={'side': side},
    )
    if not created and side and member.side != side:
        member.side = side
        member.save(update_fields=['side'])
    return member


def _parse_player_identifier(raw_value):
    value = (raw_value or '').strip()
    if not value:
        return None
    if value.upper().startswith('P-'):
        value = value[2:]
    if value.isdigit():
        return PlayerProfile.objects.select_related('selectedTank', 'user').filter(user_id=int(value)).first()
    return None


def _friend_profiles(profile):
    requests = FriendRequest.objects.filter(
        status=FriendRequest.STATUS_ACCEPTED,
    ).filter(Q(fromPlayer=profile) | Q(toPlayer=profile)).select_related(
        'fromPlayer__selectedTank',
        'toPlayer__selectedTank',
    )
    friends = []
    for request in requests:
        friend = request.toPlayer if request.fromPlayer_id == profile.id else request.fromPlayer
        friends.append(friend)
    return friends


def _is_friend(profile, other):
    return FriendRequest.objects.filter(
        status=FriendRequest.STATUS_ACCEPTED,
    ).filter(
        Q(fromPlayer=profile, toPlayer=other) | Q(fromPlayer=other, toPlayer=profile)
    ).exists()


def _pending_request_between(profile, other):
    return FriendRequest.objects.filter(
        status=FriendRequest.STATUS_PENDING,
    ).filter(
        Q(fromPlayer=profile, toPlayer=other) | Q(fromPlayer=other, toPlayer=profile)
    ).first()


@api_view(['POST'])
@permission_classes([AllowAny])
def register_user(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    profile = _get_or_create_profile(user)
    refresh = RefreshToken.for_user(user)
    return Response(
        {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'profile': PlayerProfileSerializer(profile).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def player_profile_detail(request):
    profile = _get_or_create_profile(request.user)

    if request.method == 'GET':
        return Response(PlayerProfileSerializer(profile).data)

    serializer = ProfileUpdateSerializer(
        profile,
        data=request.data,
        context={'profile': profile, 'request': request},
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(PlayerProfileSerializer(profile).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    _get_or_create_profile(request.user)
    serializer = PasswordChangeSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({'detail': 'Password updated successfully.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def select_tank(request):
    profile = _get_or_create_profile(request.user)
    serializer = SelectTankSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    profile.selectedTank_id = serializer.validated_data['tank_id']
    profile.save(update_fields=['selectedTank'])
    profile.refresh_from_db()
    return Response(PlayerProfileSerializer(profile).data)


@api_view(['GET'])
def active_lobbies(request):
    lobbies = Lobby.objects.filter(is_active=True)
    data = [
        {
            'lobby_id': lobby.id,
            'name': lobby.name,
            'is_active': lobby.is_active,
            'player_count': lobby.players.count(),
        }
        for lobby in lobbies
    ]
    serializer = LobbyStatusSerializer(data, many=True)
    return Response(serializer.data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def lobbies_collection(request):
    profile = _get_or_create_profile(request.user)

    if request.method == 'GET':
        lobbies = Lobby.objects.filter(is_active=True).prefetch_related('players__player__selectedTank')
        return Response(LobbySerializer(lobbies, many=True).data)

    serializer = LobbyCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    lobby = Lobby.objects.create(name=serializer.validated_data['name'])
    _ensure_lobby_membership(lobby, profile, serializer.validated_data['side'])
    lobby.refresh_from_db()
    return Response(_serialize_lobby(lobby), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def lobby_detail(request, lobby_id):
    _get_or_create_profile(request.user)
    try:
        lobby = Lobby.objects.prefetch_related('players__player__selectedTank').get(pk=lobby_id, is_active=True)
    except Lobby.DoesNotExist:
        return Response({'detail': 'Lobby not found.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(_serialize_lobby(lobby))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lobby_join(request, lobby_id):
    profile = _get_or_create_profile(request.user)
    serializer = LobbySideSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)

    try:
        lobby = Lobby.objects.get(pk=lobby_id, is_active=True)
    except Lobby.DoesNotExist:
        return Response({'detail': 'Lobby not found.'}, status=status.HTTP_404_NOT_FOUND)

    if lobby.players.exclude(player=profile).count() >= 10:
        return Response({'detail': 'Lobby is full.'}, status=status.HTTP_400_BAD_REQUEST)

    _ensure_lobby_membership(lobby, profile, serializer.validated_data['side'])
    lobby.refresh_from_db()
    return Response(_serialize_lobby(lobby))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lobby_leave(request, lobby_id):
    profile = _get_or_create_profile(request.user)
    LobbyPlayer.objects.filter(lobby_id=lobby_id, player=profile).delete()

    try:
        lobby = Lobby.objects.get(pk=lobby_id)
    except Lobby.DoesNotExist:
        return Response(status=status.HTTP_204_NO_CONTENT)

    if not lobby.players.exists():
        lobby.is_active = False
        lobby.save(update_fields=['is_active'])

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lobby_set_side(request, lobby_id):
    profile = _get_or_create_profile(request.user)
    serializer = LobbySideSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    try:
        member = LobbyPlayer.objects.select_related('lobby').get(lobby_id=lobby_id, player=profile)
    except LobbyPlayer.DoesNotExist:
        return Response({'detail': 'Join the lobby first.'}, status=status.HTTP_400_BAD_REQUEST)

    member.side = serializer.validated_data['side']
    member.save(update_fields=['side'])
    member.lobby.refresh_from_db()
    return Response(_serialize_lobby(member.lobby))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def friends_summary(request):
    profile = _get_or_create_profile(request.user)
    summary = {
        'playerId': f'P-{profile.user_id:04d}',
        'friends': _friend_profiles(profile),
        'outgoing': FriendRequest.objects.filter(fromPlayer=profile, status=FriendRequest.STATUS_PENDING).select_related('fromPlayer__selectedTank', 'toPlayer__selectedTank'),
        'incoming': FriendRequest.objects.filter(toPlayer=profile, status=FriendRequest.STATUS_PENDING).select_related('fromPlayer__selectedTank', 'toPlayer__selectedTank'),
        'outgoingInvites': LobbyInvite.objects.filter(fromPlayer=profile, status=LobbyInvite.STATUS_PENDING).select_related('fromPlayer__selectedTank', 'toPlayer__selectedTank', 'lobby'),
        'incomingInvites': LobbyInvite.objects.filter(toPlayer=profile, status=LobbyInvite.STATUS_PENDING).select_related('fromPlayer__selectedTank', 'toPlayer__selectedTank', 'lobby'),
    }
    return Response(FriendsSummarySerializer(summary).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def friends_search(request):
    _get_or_create_profile(request.user)
    player = _parse_player_identifier(request.query_params.get('public_id'))
    if not player:
        return Response({'detail': 'Игрок не найден.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(FriendPlayerSerializer(player).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def friend_profile(request, player_id):
    profile = _get_or_create_profile(request.user)
    other = _parse_player_identifier(player_id)
    if not other:
        return Response({'detail': 'Игрок не найден.'}, status=status.HTTP_404_NOT_FOUND)
    if not _is_friend(profile, other):
        return Response({'detail': 'Это не ваш друг.'}, status=status.HTTP_403_FORBIDDEN)
    return Response(FriendPlayerSerializer(other).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_friend_request(request):
    profile = _get_or_create_profile(request.user)
    other = _parse_player_identifier(request.data.get('public_id'))
    if not other:
        return Response({'detail': 'Игрок не найден.'}, status=status.HTTP_404_NOT_FOUND)
    if other.id == profile.id:
        return Response({'detail': 'Нельзя добавить себя.'}, status=status.HTTP_400_BAD_REQUEST)
    if _is_friend(profile, other):
        return Response({'detail': 'Вы уже друзья.'}, status=status.HTTP_400_BAD_REQUEST)
    if _pending_request_between(profile, other):
        return Response({'detail': 'Заявка уже существует.'}, status=status.HTTP_400_BAD_REQUEST)

    friend_request = FriendRequest.objects.create(fromPlayer=profile, toPlayer=other)
    return Response(FriendRequestSerializer(friend_request).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_friend_request(request, request_id):
    profile = _get_or_create_profile(request.user)
    try:
        friend_request = FriendRequest.objects.select_related('fromPlayer__selectedTank', 'toPlayer__selectedTank').get(
            pk=request_id,
            toPlayer=profile,
            status=FriendRequest.STATUS_PENDING,
        )
    except FriendRequest.DoesNotExist:
        return Response({'detail': 'Заявка не найдена.'}, status=status.HTTP_404_NOT_FOUND)

    friend_request.status = FriendRequest.STATUS_ACCEPTED
    friend_request.save(update_fields=['status'])
    return Response(FriendRequestSerializer(friend_request).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def decline_friend_request(request, request_id):
    profile = _get_or_create_profile(request.user)
    try:
        friend_request = FriendRequest.objects.get(
            pk=request_id,
            status=FriendRequest.STATUS_PENDING,
        )
    except FriendRequest.DoesNotExist:
        return Response({'detail': 'Заявка не найдена.'}, status=status.HTTP_404_NOT_FOUND)

    if friend_request.fromPlayer_id != profile.id and friend_request.toPlayer_id != profile.id:
        return Response({'detail': 'Нет доступа к заявке.'}, status=status.HTTP_403_FORBIDDEN)

    friend_request.status = FriendRequest.STATUS_DECLINED
    friend_request.save(update_fields=['status'])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invite_friend_to_lobby(request, player_id):
    profile = _get_or_create_profile(request.user)
    other = _parse_player_identifier(player_id)
    if not other:
        return Response({'detail': 'Игрок не найден.'}, status=status.HTTP_404_NOT_FOUND)
    if not _is_friend(profile, other):
        return Response({'detail': 'Можно приглашать только друзей.'}, status=status.HTTP_403_FORBIDDEN)

    membership = LobbyPlayer.objects.select_related('lobby').filter(player=profile, lobby__is_active=True).first()
    if not membership:
        return Response({'detail': 'Сначала войдите в лобби.'}, status=status.HTTP_400_BAD_REQUEST)

    invite = LobbyInvite.objects.create(fromPlayer=profile, toPlayer=other, lobby=membership.lobby)
    return Response(LobbyInviteSerializer(invite).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_lobby_invite(request, invite_id):
    profile = _get_or_create_profile(request.user)
    try:
        invite = LobbyInvite.objects.select_related('lobby').get(
            pk=invite_id,
            toPlayer=profile,
            status=LobbyInvite.STATUS_PENDING,
        )
    except LobbyInvite.DoesNotExist:
        return Response({'detail': 'Приглашение не найдено.'}, status=status.HTTP_404_NOT_FOUND)

    _ensure_lobby_membership(invite.lobby, profile, 'allies')
    invite.status = LobbyInvite.STATUS_ACCEPTED
    invite.save(update_fields=['status'])
    invite.lobby.refresh_from_db()
    return Response(LobbySerializer(invite.lobby).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def decline_lobby_invite(request, invite_id):
    profile = _get_or_create_profile(request.user)
    try:
        invite = LobbyInvite.objects.get(
            pk=invite_id,
            status=LobbyInvite.STATUS_PENDING,
        )
    except LobbyInvite.DoesNotExist:
        return Response({'detail': 'Приглашение не найдено.'}, status=status.HTTP_404_NOT_FOUND)

    if invite.fromPlayer_id != profile.id and invite.toPlayer_id != profile.id:
        return Response({'detail': 'Нет доступа к приглашению.'}, status=status.HTTP_403_FORBIDDEN)

    invite.status = LobbyInvite.STATUS_DECLINED
    invite.save(update_fields=['status'])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([AllowAny])
def catalog_metadata(request):
    tanks = Tank.objects.select_related('stats').all()
    arenas = Arena.objects.prefetch_related('obstacles').all()
    return Response(
        {
            'tanks': TankSerializer(tanks, many=True).data,
            'arenas': ArenaSerializer(arenas, many=True).data,
        }
    )


@api_view(['POST'])
def object_move(request):
    return Response(calculate_cube_move(request.data))


@api_view(['POST'])
def proto_tank_move(request):
    return Response(calculate_proto_tank_move(request.data))


@api_view(['POST'])
def proto_tank_bullets(request):
    return Response(calculate_proto_tank_bullets(request.data))
