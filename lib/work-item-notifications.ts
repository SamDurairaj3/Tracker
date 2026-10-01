import { pushSubscriptions } from '../db/push-subscriptions';
import type { WorkItemActor } from '../db/work-items';
import type { WorkItem, WorkItemActivity } from './work-items';
import { readVapidConfig } from './push-config';
import { sendWebPush, type PushPayload } from './web-push';

export type WorkItemNotificationPlan = {
  recipients: string[];
  payload: PushPayload;
};

export type WorkItemNotifier = {
  created(item: WorkItem, actor: WorkItemActor): Promise<void>;
  updated(before: WorkItem, after: WorkItem, actor: WorkItemActor): Promise<void>;
  activity(item: WorkItem, actor: WorkItemActor): Promise<void>;
  comment(item: WorkItem, activity: WorkItemActivity, actor: WorkItemActor): Promise<void>;
};

function participants(item: WorkItem) {
  return Array.from(new Set([
    item.owner,
    ...item.checklist.map((step) => step.assignee),
  ].filter(Boolean)));
}

function withoutActor(names: string[], actor: WorkItemActor) {
  return names.filter((name) => name !== actor.name);
}

function cardUrl(item: WorkItem) {
  return `/mobile?workItem=${encodeURIComponent(item.id)}`;
}

export function planCreatedNotifications(item: WorkItem, actor: WorkItemActor) {
  const plans: WorkItemNotificationPlan[] = [];
  if (item.owner !== actor.name) {
    plans.push({
      recipients: [item.owner],
      payload: {
        title: 'New work card assigned to you',
        body: `${item.id} · ${item.title}`,
        tag: `card-created:${item.id}`,
        url: cardUrl(item),
      },
    });
  }
  const checklistAssignees = withoutActor(
    Array.from(new Set(item.checklist.map((step) => step.assignee))),
    actor,
  ).filter((name) => name !== item.owner);
  if (checklistAssignees.length) {
    plans.push({
      recipients: checklistAssignees,
      payload: {
        title: 'New checklist assignment',
        body: `${item.id} · ${item.title}`,
        tag: `checklist-assigned:${item.id}`,
        url: cardUrl(item),
      },
    });
  }
  return plans;
}

export function planUpdatedNotifications(before: WorkItem, after: WorkItem, actor: WorkItemActor) {
  const plans: WorkItemNotificationPlan[] = [];
  const specificallyNotified = new Set<string>();
  if (before.owner !== after.owner && after.owner !== actor.name) {
    specificallyNotified.add(after.owner);
    plans.push({
      recipients: [after.owner],
      payload: {
        title: 'Work card assigned to you',
        body: `${after.id} · ${after.title}`,
        tag: `owner-assigned:${after.id}`,
        url: cardUrl(after),
      },
    });
  }

  const beforeById = new Map(before.checklist.map((step) => [step.id, step]));
  const newAssignees = Array.from(new Set(after.checklist.flatMap((step) => {
    const previous = beforeById.get(step.id);
    return (!previous || previous.assignee !== step.assignee) && step.assignee !== actor.name
      ? [step.assignee]
      : [];
  })));
  for (const name of newAssignees) specificallyNotified.add(name);
  if (newAssignees.length) {
    plans.push({
      recipients: newAssignees,
      payload: {
        title: 'New checklist assignment',
        body: `${after.id} · ${after.title}`,
        tag: `checklist-assigned:${after.id}`,
        url: cardUrl(after),
      },
    });
  }

  const activityRecipients = withoutActor(participants(after), actor)
    .filter((name) => !specificallyNotified.has(name));
  if (activityRecipients.length) {
    plans.push({
      recipients: activityRecipients,
      payload: {
        title: `Activity on ${after.id}`,
        body: `${actor.name} updated ${after.title}`,
        tag: `activity:${after.id}`,
        url: cardUrl(after),
      },
    });
  }
  return plans;
}

function activityPlan(item: WorkItem, actor: WorkItemActor): WorkItemNotificationPlan[] {
  const recipients = withoutActor(participants(item), actor);
  return recipients.length ? [{
    recipients,
    payload: {
      title: `Activity on ${item.id}`,
      body: `${actor.name} updated ${item.title}`,
      tag: `activity:${item.id}`,
      url: cardUrl(item),
    },
  }] : [];
}

function commentPlan(
  item: WorkItem,
  activity: WorkItemActivity,
  actor: WorkItemActor,
): WorkItemNotificationPlan[] {
  const recipients = withoutActor(participants(item), actor);
  return recipients.length ? [{
    recipients,
    payload: {
      title: `New comment on ${item.id}`,
      body: activity.checklistTitle
        ? `${actor.name} commented on “${activity.checklistTitle}”`
        : `${actor.name} commented on ${item.title}`,
      tag: `comment:${item.id}`,
      url: cardUrl(item),
    },
  }] : [];
}

async function deliver(plans: WorkItemNotificationPlan[]) {
  if (!plans.length) return;
  try {
    const config = readVapidConfig();
    for (const plan of plans) {
      const subscriptions = await pushSubscriptions.listForNames(plan.recipients);
      await Promise.all(subscriptions.map(async (subscription) => {
        try {
          const response = await sendWebPush(subscription, plan.payload, config);
          if (response.status === 404 || response.status === 410) {
            await pushSubscriptions.removeById(subscription.id);
          } else if (!response.ok) {
            console.error(`Push service rejected a notification with status ${response.status}.`);
          }
        } catch (error) {
          console.error('Unable to deliver a push notification', error);
        }
      }));
    }
  } catch (error) {
    // Work mutations must succeed even if push configuration or a provider is unavailable.
    console.error('Push notification dispatch was skipped', error);
  }
}

export const workItemNotifier: WorkItemNotifier = {
  created: (item, actor) => deliver(planCreatedNotifications(item, actor)),
  updated: (before, after, actor) => deliver(planUpdatedNotifications(before, after, actor)),
  activity: (item, actor) => deliver(activityPlan(item, actor)),
  comment: (item, activity, actor) => deliver(commentPlan(item, activity, actor)),
};
