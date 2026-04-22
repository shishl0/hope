from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .views import (
    ArenaList,
    TankViewSet,
    active_lobbies,
    catalog_metadata,
    change_password,
    friend_profile,
    friends_search,
    friends_summary,
    send_friend_request,
    accept_friend_request,
    decline_friend_request,
    invite_friend_to_lobby,
    accept_lobby_invite,
    decline_lobby_invite,
    lobbies_collection,
    lobby_detail,
    lobby_join,
    lobby_leave,
    lobby_set_side,
    object_move,
    player_profile_detail,
    proto_tank_bullets,
    proto_tank_move,
    register_user,
    select_tank,
)

router = DefaultRouter()
router.register(r'tanks', TankViewSet)

urlpatterns = [
    # JWT Auth
    path('auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/register/', register_user, name='auth-register'),
    path('auth/change-password/', change_password, name='auth-change-password'),
    
    # CBV
    path('', include(router.urls)),
    path('arenas/', ArenaList.as_view(), name='arena-list'),
    
    # FBV
    path('catalog/', catalog_metadata, name='catalog-metadata'),
    path('profile/', player_profile_detail, name='player-profile'),
    path('profile/select-tank/', select_tank, name='select-tank'),
    path('friends/', friends_summary, name='friends-summary'),
    path('friends/search/', friends_search, name='friends-search'),
    path('friends/request/', send_friend_request, name='friends-request'),
    path('friends/requests/<int:request_id>/accept/', accept_friend_request, name='friends-request-accept'),
    path('friends/requests/<int:request_id>/decline/', decline_friend_request, name='friends-request-decline'),
    path('friends/<str:player_id>/profile/', friend_profile, name='friend-profile'),
    path('friends/<str:player_id>/invite/', invite_friend_to_lobby, name='friend-invite'),
    path('friends/invites/<int:invite_id>/accept/', accept_lobby_invite, name='friend-invite-accept'),
    path('friends/invites/<int:invite_id>/decline/', decline_lobby_invite, name='friend-invite-decline'),
    path('lobbies/', lobbies_collection, name='lobbies-collection'),
    path('lobbies/<int:lobby_id>/', lobby_detail, name='lobby-detail'),
    path('lobbies/<int:lobby_id>/join/', lobby_join, name='lobby-join'),
    path('lobbies/<int:lobby_id>/leave/', lobby_leave, name='lobby-leave'),
    path('lobbies/<int:lobby_id>/side/', lobby_set_side, name='lobby-set-side'),
    path('lobbies/active/', active_lobbies, name='active-lobbies'),

    # Object movement endpoint
    path('object/move/', object_move, name='object-move'),
    path('object/move/state', object_move, name='object-move-state'),
    path('proto-tank/move/', proto_tank_move, name='proto-tank-move'),
    path('proto-tank/bullets/', proto_tank_bullets, name='proto-tank-bullets'),
]
