from django.db import models

class Song(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"), ("processing", "Processing"),
        ("ready", "Ready"), ("failed", "Failed"),
    ]
    title = models.CharField(max_length=200)
    artist = models.CharField(max_length=200)
    album = models.CharField(max_length=200, blank=True)
    genre = models.CharField(max_length=100, blank=True)
    cover = models.ImageField(upload_to="covers/", blank=True, null=True)
    original_file = models.FileField(upload_to="originals/")
    hls_master_path = models.CharField(max_length=500, blank=True)
    processing_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    duration = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} — {self.artist}"
