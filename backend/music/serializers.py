from pathlib import Path
from rest_framework import serializers
from .models import Song

class SongSerializer(serializers.ModelSerializer):
    stream_url = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Song
        fields = [
            "id", "title", "artist", "album", "genre", "cover", "cover_url",
            "original_file", "duration", "processing_status", "hls_master_path",
            "stream_url", "created_at",
        ]
        read_only_fields = ["duration", "processing_status", "hls_master_path", "created_at"]

    def validate_original_file(self, value):
        if Path(value.name).suffix.lower() != ".mp3":
            raise serializers.ValidationError("Please upload an MP3 file.")
        if value.size > 100 * 1024 * 1024:
            raise serializers.ValidationError("MP3 must be 100 MB or smaller.")
        return value

    def validate_cover(self, value):
        if value and value.size > 8 * 1024 * 1024:
            raise serializers.ValidationError("Cover image must be 8 MB or smaller.")
        return value

    def get_stream_url(self, obj):
        if not obj.hls_master_path or obj.processing_status != "ready":
            return None
        path = f"/media/{obj.hls_master_path}"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_cover_url(self, obj):
        if not obj.cover:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.cover.url) if request else obj.cover.url
