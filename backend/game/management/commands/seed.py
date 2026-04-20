from django.core.management.base import BaseCommand

from game.models import Arena, Obstacle, Tank, TankStats


TANKS = [
    {
        'name': 'T-34',
        'side': 'USSR',
        'bodyModelKey': 't-34-body',
        'turretModelKey': 't-34-tower',
        'bulletModelKey': 'primitive-bullet',
        'description': (
            'Fast Soviet medium tank with sloped armor, strong mobility, '
            'and a reliable gun profile for balanced play.'
        ),
        'stats': {
            'moveSpeed': 0.075,
            'maxHP': 760,
            'reloadSpeed': 4.8,
            'rotationSpeed': 0.058,
            'turretRotationSpeed': 0.034,
            'bulletSpeed': 1.15,
            'bulletDamage': 160,
        },
    },
    {
        'name': 'Panzer IV',
        'side': 'Germany',
        'bodyModelKey': 'panzer-4-body',
        'turretModelKey': 'panzer-4-tower',
        'bulletModelKey': 'primitive-bullet',
        'description': (
            'German medium tank with solid fire control, steadier handling, '
            'and a harder-hitting long-barrel gun profile.'
        ),
        'stats': {
            'moveSpeed': 0.065,
            'maxHP': 720,
            'reloadSpeed': 5.2,
            'rotationSpeed': 0.052,
            'turretRotationSpeed': 0.030,
            'bulletSpeed': 1.25,
            'bulletDamage': 175,
        },
    },
]


ARENA = {
    'name': 'start_arena',
    'modelKey': 'arena-1',
    'description': 'Starter battlefield used by Angular to build the first playable arena.',
}


OBSTACLES = [
    {
        'type': 'simple_rock',
        'modelKey': 'obstacle',
        'x': 0,
        'y': 0.5,
        'z': 5,
        'rotationY': 0,
        'scaleX': 2,
        'scaleY': 1,
        'scaleZ': 2,
    },
    {
        'type': 'simple_rock',
        'modelKey': 'obstacle',
        'x': 4,
        'y': 0.5,
        'z': 2,
        'rotationY': 0.6,
        'scaleX': 2,
        'scaleY': 1,
        'scaleZ': 2,
    },
    {
        'type': 'simple_rock',
        'modelKey': 'obstacle',
        'x': -4,
        'y': 0.5,
        'z': -3,
        'rotationY': -0.35,
        'scaleX': 2.4,
        'scaleY': 1,
        'scaleZ': 1.7,
    },
    {
        'type': 'simple_rock',
        'modelKey': 'obstacle',
        'x': 6,
        'y': 0.5,
        'z': -5,
        'rotationY': 1.2,
        'scaleX': 1.8,
        'scaleY': 1,
        'scaleZ': 2.2,
    },
]


class Command(BaseCommand):
    help = 'Seed stable gameplay metadata for tanks, arenas, and obstacles.'

    def handle(self, *args, **options):
        created_stats = 0
        updated_stats = 0
        created_tanks = 0
        updated_tanks = 0

        for tank_data in TANKS:
            stats_data = tank_data['stats']
            tank_defaults = {
                key: value
                for key, value in tank_data.items()
                if key != 'stats'
            }

            tank, tank_created = Tank.objects.update_or_create(
                name=tank_data['name'],
                defaults=tank_defaults,
            )

            if tank.stats_id is None:
                stats = TankStats.objects.create(**stats_data)
                created_stats += 1
            else:
                stats = tank.stats
                for field, value in stats_data.items():
                    setattr(stats, field, value)
                stats.save()
                updated_stats += 1

            tank.stats = stats
            tank.save()

            if tank_created:
                created_tanks += 1
            else:
                updated_tanks += 1

        arena, arena_created = Arena.objects.update_or_create(
            name=ARENA['name'],
            defaults={
                'modelKey': ARENA['modelKey'],
                'description': ARENA['description'],
            },
        )

        created_obstacles = 0
        updated_obstacles = 0
        for obstacle_data in OBSTACLES:
            _obstacle, obstacle_created = Obstacle.objects.update_or_create(
                arena=arena,
                type=obstacle_data['type'],
                x=obstacle_data['x'],
                z=obstacle_data['z'],
                defaults=obstacle_data,
            )

            if obstacle_created:
                created_obstacles += 1
            else:
                updated_obstacles += 1

        arena_action = 'created' if arena_created else 'updated'
        self.stdout.write(self.style.SUCCESS('Seed completed.'))
        self.stdout.write(f'Tanks: {created_tanks} created, {updated_tanks} updated.')
        self.stdout.write(f'Tank stats: {created_stats} created, {updated_stats} updated.')
        self.stdout.write(f'Arena: {arena_action} {arena.name}.')
        self.stdout.write(f'Obstacles: {created_obstacles} created, {updated_obstacles} updated.')
