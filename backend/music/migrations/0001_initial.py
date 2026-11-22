# Initial schema retained for compatibility with the first Jacked release.
from django.db import migrations, models

class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name='Song',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('artist', models.CharField(max_length=200)),
                ('album', models.CharField(blank=True, max_length=200)),
                ('genre', models.CharField(blank=True, max_length=100)),
                ('cover', models.ImageField(blank=True, null=True, upload_to='covers/')),
                ('original_file', models.FileField(upload_to='originals/')),
                ('hls_master_path', models.CharField(blank=True, max_length=500)),
                ('processing_status', models.CharField(choices=[('pending', 'Pending'), ('processing', 'Processing'), ('ready', 'Ready'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('duration', models.FloatField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
