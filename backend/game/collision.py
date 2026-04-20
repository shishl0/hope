def get_aabb(position, size):
    half_size = [axis / 2 for axis in size]

    return {
        'min_x': position[0] - half_size[0],
        'max_x': position[0] + half_size[0],
        'min_y': position[1] - half_size[1],
        'max_y': position[1] + half_size[1],
        'min_z': position[2] - half_size[2],
        'max_z': position[2] + half_size[2],
    }


def aabb_intersects(first, second):
    return (
        first['min_x'] <= second['max_x'] and first['max_x'] >= second['min_x'] and
        first['min_y'] <= second['max_y'] and first['max_y'] >= second['min_y'] and
        first['min_z'] <= second['max_z'] and first['max_z'] >= second['min_z']
    )


def object_collides(candidate, objects, ignore_id=None):
    candidate_box = get_aabb(candidate['position'], candidate['size'])

    for object_id, game_object in objects.items():
        if object_id == ignore_id:
            continue

        object_box = get_aabb(game_object['position'], game_object['size'])
        if aabb_intersects(candidate_box, object_box):
            return True

    return False


def clamp_to_world(position, world_half_size, size):
    half_x = size[0] / 2
    half_z = size[2] / 2

    position[0] = max(-world_half_size + half_x, min(world_half_size - half_x, position[0]))
    position[2] = max(-world_half_size + half_z, min(world_half_size - half_z, position[2]))

    return position
