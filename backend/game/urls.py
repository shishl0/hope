from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .views import TankViewSet, ArenaList, player_profile_detail, active_lobbies, object_move

router = DefaultRouter()
router.register(r'tanks', TankViewSet)

urlpatterns = [
    # JWT Auth
    path('auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    
    # CBV
    path('', include(router.urls)),
    path('arenas/', ArenaList.as_view(), name='arena-list'),
    
    # FBV
    path('profile/', player_profile_detail, name='player-profile'),
    path('lobbies/active/', active_lobbies, name='active-lobbies'),

    # Object movement endpoint
    path('object/move/', object_move, name='object-move'),
    path('object/move/state', object_move, name='object-move-state'),
]
