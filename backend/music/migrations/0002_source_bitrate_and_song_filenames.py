from django.db import migrations, models
import music.models

class Migration(migrations.Migration):
    dependencies = [('music', '0001_initial')]
    operations = [
        migrations.AddField(
            model_name='song',
            name='source_bitrate',
            field=models.PositiveIntegerField(default=0, help_text='Source bitrate in kbps'),
        ),
        migrations.AlterField(
            model_name='song',
            name='original_file',
            field=models.FileField(upload_to=music.models.original_upload_path),
        ),
    ]
