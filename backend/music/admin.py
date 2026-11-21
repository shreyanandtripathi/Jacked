from django.contrib import admin
from .models import Song

@admin.register(Song)
class SongAdmin(admin.ModelAdmin):
    list_display = ("title", "artist", "album", "processing_status", "duration", "created_at")
    list_filter = ("processing_status", "genre", "created_at")
    search_fields = ("title", "artist", "album", "genre")
    readonly_fields = ("duration", "hls_master_path", "processing_status", "created_at")
