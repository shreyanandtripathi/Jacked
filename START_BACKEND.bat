@echo off
cd /d "%~dp0backend"
if not exist venv python -m venv venv
call venv\Scripts\activate
pip install -r requirements.txt
python manage.py makemigrations music
python manage.py migrate
python manage.py runserver
