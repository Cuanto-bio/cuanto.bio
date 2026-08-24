import {
  defineRailway,
  image,
  preserve,
  project,
  service,
  volume,
} from 'railway/iac';

export default defineRailway(() => {
  const tapVolume = volume('tap-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'asia-southeast1-eqsg3a',
    sizeMB: 5000,
  });
  const postgisVolume = volume('postgis-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'asia-southeast1-eqsg3a',
    sizeMB: 5000,
  });
  const PostGIS = service('PostGIS', {
    source: image('postgis/postgis:16-master'),
    replicas: { 'asia-southeast1-eqsg3a': 1 },
    deploy: { requiredMountPath: '/var/lib/postgresql/data' },
    networking: { privateNetworkEndpoint: 'postgis' },
    volumeMounts: {
      '/var/lib/postgresql/data': postgisVolume,
    },
    env: {
      DATABASE_PRIVATE_URL: preserve(),
      DATABASE_URL: preserve(),
      PGDATA: preserve(),
      PGHOST: preserve(),
      PGPORT: preserve(),
      POSTGRES_DB: preserve(),
      POSTGRES_INITDB_ARGS: preserve(),
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_USER: preserve(),
    },
  });
  const tap = service('tap', {
    source: image('ghcr.io/bluesky-social/indigo/tap:latest'),
    replicas: { 'asia-southeast1-eqsg3a': 1 },
    volumeMounts: {
      '/data': tapVolume,
    },
    env: {
      TAP_ADMIN_PASSWORD: preserve(),
      TAP_COLLECTION_FILTERS: preserve(),
      TAP_CURSOR_SAVE_INTERVAL: preserve(),
      TAP_DATABASE_URL: preserve(),
      TAP_SIGNAL_COLLECTION: preserve(),
      TAP_WEBHOOK_URL: preserve(),
    },
  });
  const app = service('app', {
    replicas: { 'asia-southeast1-eqsg3a': 1 },
    domains: ['cuanto.bio'],
    // Builder is Dockerfile via Railway auto-detection; declaring it explicitly
    // creates permanent plan drift because Railway won't store the value.
    deploy: {
      healthcheckPath: '/',
      healthcheckTimeout: 30,
    },
    env: {
      APP_COMMIT_SHA: preserve(),
      DATABASE_URL: preserve(),
      ORIGIN: preserve(),
      PRIVATE_OAUTH_KEY: preserve(),
      PUBLIC_DATABASE_URL: preserve(),
      PUBLIC_OAUTH_CLIENT_ID: preserve(),
      PUBLIC_URL: preserve(),
      TAP_ADMIN_PASSWORD: preserve(),
      TAP_URL: preserve(),
    },
  });

  return project('Cuanto.bio', {
    resources: [PostGIS, tap, app, tapVolume, postgisVolume],
  });
});
