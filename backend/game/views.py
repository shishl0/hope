from django.shortcuts import render
import math
from rest_framework import viewsets, generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Tank, PlayerProfile, Arena, Lobby, LobbyPlayer
from .serializers import TankSerializer, ArenaSerializer, PlayerProfileSerializer, LobbyStatusSerializer

PLAYER_STATE = {
    'position': [0, 0, 0],
    'rotation': [0, 0, 0],
}

MOVE_SPEED = 0.5
ROTATE_SPEED = 0.1

# 0. Test Game View
def test_game_view(request):
    return render(request, 'game/test_game.html')

# 1. CBV Full CRUD
class TankViewSet(viewsets.ModelViewSet):
    queryset = Tank.objects.all()
    serializer_class = TankSerializer
    permission_classes = [IsAuthenticated]

# 2. CBV
class ArenaList(generics.ListCreateAPIView):
    queryset = Arena.objects.all()
    serializer_class = ArenaSerializer
    permission_classes = [IsAuthenticated]

# 3. FBV
@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def player_profile_detail(request):
    """
    Retrieve or update the current user's profile.
    Data is linked to request.user.
    """
    try:
        profile = request.user.profile
    except PlayerProfile.DoesNotExist:
        # Create a basic profile if it doesn't exist
        profile = PlayerProfile.objects.create(user=request.user, nickname=f"Player_{request.user.id}")

    if request.method == 'GET':
        serializer = PlayerProfileSerializer(profile)
        return Response(serializer.data)

    elif request.method == 'PUT':
        serializer = PlayerProfileSerializer(profile, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# 4. FBV
@api_view(['GET'])
def active_lobbies(request):
    lobbies = Lobby.objects.filter(is_active=True)
    data = []
    for lobby in lobbies:
        data.append({
            'lobby_id': lobby.id,
            'name': lobby.name,
            'is_active': lobby.is_active,
            'player_count': lobby.players.count()
        })
    serializer = LobbyStatusSerializer(data, many=True)
    return Response(serializer.data)


@api_view(['POST'])
def object_move(request):
    forward = request.data.get('forward', False)
    backward = request.data.get('backward', False)
    rotate_left = request.data.get('rotateleft', False)
    rotate_right = request.data.get('rotateright', False)

    if rotate_left:
        PLAYER_STATE['rotation'][1] -= ROTATE_SPEED
    if rotate_right:
        PLAYER_STATE['rotation'][1] += ROTATE_SPEED

    dir_x = math.sin(PLAYER_STATE['rotation'][1])
    dir_z = math.cos(PLAYER_STATE['rotation'][1])

    if forward:
        PLAYER_STATE['position'][0] += dir_x * MOVE_SPEED
        PLAYER_STATE['position'][2] += dir_z * MOVE_SPEED
    if backward:
        PLAYER_STATE['position'][0] -= dir_x * MOVE_SPEED
        PLAYER_STATE['position'][2] -= dir_z * MOVE_SPEED

    return Response(PLAYER_STATE)
