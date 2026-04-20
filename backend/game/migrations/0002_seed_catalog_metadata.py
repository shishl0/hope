from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('game', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='arena',
            name='modelKey',
            field=models.CharField(default='default_arena', max_length=100),
        ),
        migrations.AddField(
            model_name='obstacle',
            name='modelKey',
            field=models.CharField(default='default_obstacle', max_length=100),
        ),
    ]
