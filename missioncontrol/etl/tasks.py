import logging
import requests

from missioncontrol.base.models import (Channel,
                                        Experiment,
                                        Measure)
from missioncontrol.celery import celery
from missioncontrol.settings import FIREFOX_EXPERIMENTS_URL
from missioncontrol.etl.measure import update_measure
from .experiment import update_experiment

logger = logging.getLogger(__name__)


@celery.task
def update_measures():
    """
    Updates channel/platform data
    """
    logger.info('Scheduling data updates...')
    for channel_name in Channel.objects.values_list('name', flat=True):
        for (measure_name, platform_name) in Measure.objects.exclude(
                platform=None).values_list('name', 'platform__name'):
            update_measure.apply_async(
                args=[platform_name, channel_name, measure_name])


@celery.task
def update_experiment_data():
    """
    Updates the actual measures for all active experiments
    """
    active_experiments = Experiment.objects.filter(enabled=True).values_list(
        'name', flat=True)
    for active_experiment in active_experiments:
        update_experiment.apply_async(
            args=[active_experiment])


@celery.task
def update_experiment_list():
    """
    Updates the internal list of active experiments
    """
    logger.info('Updating active experiments...')
    r = requests.get(FIREFOX_EXPERIMENTS_URL)
    enabled_experiment_slugs = []
    for experiment in r.json():
        try:
            slug = experiment['recipe']['arguments']['slug']
        except KeyError:
            # not an experiment, continue
            continue
        Experiment.objects.update_or_create(
            name=slug, defaults={'enabled': True})
        enabled_experiment_slugs.append(slug)

    # any experiments not specified in that list should be considered inactive
    Experiment.objects.exclude(name__in=enabled_experiment_slugs).update(
        enabled=False)
