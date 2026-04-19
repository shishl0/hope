from rest_framework.response import Response
from rest_framework.decorators import api_view

import math

PLAYER_STATE = {
    'position': [0, 0, 0],
    'rotation': [0, 0, 0],
}

MOVE_SPEED = 0.5
ROTATE_SPEED = 0.1  

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