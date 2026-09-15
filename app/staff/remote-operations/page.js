"use client";

/**
 * /staff/remote-operations — retired.
 *
 * The workspace collected two unrelated things:
 *
 *   1. Questions, issues and handovers. This duplicated the Service Requests
 *      "Remote / delivery issue" type, which is strictly richer — it captures
 *      issue type, project/client and priority, and it runs through the
 *      governed request workflow (assignment, approval, audit) that the old
 *      free-text form bypassed entirely.
 *
 *   2. Remote-work profiles (base location, time zone, overlap hours). These
 *      are reference data, not requests, and remain readable by administrators
 *      in the admin Remote Operations oversight view. No profile data has been
 *      deleted — remote_work_profiles is untouched.
 *
 * Task briefs were never part of this page. They live in the RemoteTasks
 * workspace, reachable from My Projects and from Notifications.
 *
 * The route is kept as a redirect rather than removed, because notification
 * hrefs already written into portal_events point at it. Deleting it outright
 * would 404 every historical task-brief notification.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RetiredRemoteOperationsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/staff/service-requests?type=remote_issue");
  }, [router]);
  return null;
}
