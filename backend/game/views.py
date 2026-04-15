from django.shortcuts import render
from rest_framework import viewsets, generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Tank, PlayerProfile, Arena, Lobby, LobbyPlayer
from .serializers import TankSerializer, ArenaSerializer, PlayerProfileSerializer, LobbyStatusSerializer

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
