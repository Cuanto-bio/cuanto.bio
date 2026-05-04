import type { PendingSurvey } from './db';
import { deletePendingSurvey, getPendingSurveys } from './db';

export async function uploadPendingSurvey(
  survey: PendingSurvey,
): Promise<{ surveyUri: string; handle: string }> {
  const resp = await fetch('/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(survey),
  });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return (await resp.json()) as { surveyUri: string; handle: string };
}

export async function uploadAllPending(): Promise<void> {
  const pending = await getPendingSurveys();
  for (const survey of pending) {
    if (!survey.complete) continue;
    try {
      await uploadPendingSurvey(survey);
      if (survey.id != null) await deletePendingSurvey(survey.id);
    } catch {
      // leave in queue; will retry next call
    }
  }
}
