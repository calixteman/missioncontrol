# -*- coding: utf-8 -*-
# Generated by Django 1.11.5 on 2018-01-24 19:13
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('base', '0002_add_experiments'),
    ]

    operations = [
        migrations.AlterField(
            model_name='experiment',
            name='name',
            field=models.CharField(max_length=255, unique=True),
        ),
    ]
