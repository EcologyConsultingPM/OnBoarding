"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Edit3, Loader2, RefreshCw, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import useUnsavedGuard from "../lib/useUnsavedGuard";
import { calendarDayPolicy, eventFallsOnWorkDay, isNonWorkingDay } from "../lib/staffCalendarScheduling";

const STATUS = {
  available: { label: "Available", color: "#469b69" },
  near_capacity: { label: "Near capacity", color: "#d5983d" },
  full: { label: "Full capacity", color: "#c76347" },
  over_capacity: { label: "Over capacity", color: "#8e2f2f" },
  on_leave: { label: "On leave", color: "#8d62ab" },
};

const EVENT = {
  activity: { label: "Project activity", color: "#3f7eae" },
  field_survey: { label: "Field survey", color: "#469b69" },
  task_brief: { label: "Task brief", color: "#2f8f8f" },
  leave: { label: "Approved leave", color: "#c76347" },
  // Approved training is unavailable time in the same way leave is. It was
  // approved through Service Requests and then never appeared in the capacity
  // picture, so a person could be booked onto fieldwork on a day their course
  // had already been signed off.
  training: { label: "Approved training", color: "#b8862f" },
  document_review: { label: "Document review", color: "#6b7fa8" },
  schedule: { label: "Schedule", color: "#d5b243" },
  milestone: { label: "Milestone", color: "#8d62ab" },
};

const DAY = 24 * 60 * 60 * 1000;

function dateText(value, options = { day: "numeric", month: "short" }) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-AU", options);
}

function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function shiftDate(value, count) {
  const d = new Date(`${value}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return localDate(d);
}

function weekStart(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return localDate(date);
}

function monthStart(value) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return localDate(date);
}

function monthEnd(value) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return localDate(date);
}

function yearStart(value) {
  return `${value.slice(0, 4)}-01-01`;
}

function yearEnd(value) {
  return `${value.slice(0, 4)}-12-31`;
}

function shiftMonth(value, count) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return localDate(date);
}

function shiftYear(value, count) {
  const date = new Date(`${value.slice(0, 4)}-01-01T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + count);
  return localDate(date);
}

function periodFor(mode, anchorDate, customStart, customEnd) {
  if (mode === "month") {
    const start = monthStart(anchorDate);
    return { start, end: monthEnd(start) };
  }
  if (mode === "year") {
    return { start: yearStart(anchorDate), end: yearEnd(anchorDate) };
  }
  if (mode === "range") {
    return { start: customStart, end: customEnd };
  }
  const start = weekStart(anchorDate);
  return { start, end: shiftDate(start, 6) };
}

function periodLabel(mode, start, end) {
  if (mode === "year") return start.slice(0, 4);
  if (mode === "month") return dateText(start, { month: "long", year: "numeric" });
  const first = dateText(start, { day: "numeric", month: "short", year: "numeric" });
  const last = dateText(end, { day: "numeric", month: "short", year: "numeric" });
  return first === last ? first : `${first} – ${last}`;
}

export default function StaffCapacityPlanner({ compact = false, onSelectStaff = null, mode = "admin" }) {
  const { session } = useAuth();
  const endpoint = mode === "staff" ? "/api/staff/capacity" : "/api/admin/staff-capacity";
  const today = localDate();
  const [viewMode, setViewMode] = useState("week");
  const [anchorDate, setAnchorDate] = useState(today);
  const [customStart, setCustomStart] = useState(weekStart(today));
  const [customEnd, setCustomEnd] = useState(shiftDate(weekStart(today), 6));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lastReturnRefreshRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef(null);
  const refreshBlockedRef = useRef(false);
  const deferredRefreshRef = useRef(false);
  const modalInitialRef = useRef(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({});

  // Inline per-person editor: contracted weekly hours and a note. Two fields
  // saved immediately, so localStorage draft retention would be more machinery
  // than the risk warrants — but closing the row still discards typing, and
  // capacity figures feed the whole resourcing picture.
  const capacityDirty = Boolean(
    editing &&
    draft[editing] &&
    (String(draft[editing].weeklyCapacityHours ?? "") !== String(
      (data?.people || []).find((p) => p.id === editing)?.weeklyCapacityHours ?? "",
    ) ||
      String(draft[editing].notes ?? "") !== String(
        (data?.people || []).find((p) => p.id === editing)?.notes ?? "",
      )),
  );

  const [saving, setSaving] = useState(false);
  const [unassignedModal, setUnassignedModal] = useState(null); // admin: { activityId, projectId, title, taskCategory, budgetHours, startDate, dueDate, staffUserId }
  const [manualTaskModal, setManualTaskModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [draggedActivity, setDraggedActivity] = useState(null);
  const [claimRequest, setClaimRequest] = useState(null); // staff: the event being confirmed for a service request
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

  const calendarEditDirty = Boolean(
    (unassignedModal || manualTaskModal) &&
    JSON.stringify(unassignedModal || manualTaskModal) !== JSON.stringify(modalInitialRef.current),
  );
  useUnsavedGuard(capacityDirty || calendarEditDirty, "A calendar or capacity change has not been saved.");
  // Keep even a clean open editor's context stable. In-flight GETs also consult
  // this ref before applying a response, so opening/typing cannot be clobbered.
  const refreshBlocked = Boolean(editing || unassignedModal || manualTaskModal || saving || modalBusy);
  refreshBlockedRef.current = refreshBlocked;

  const period = useMemo(
    () => periodFor(viewMode, anchorDate, customStart, customEnd),
    [viewMode, anchorDate, customStart, customEnd],
  );

  const load = useCallback(async () => {
    if (!session?.access_token) {
      requestSequenceRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      deferredRefreshRef.current = false;
      setRefreshPending(false);
      setData(() => null);
      setLastRefreshed(null);
      setLoading(false);
      return;
    }
    if (refreshBlockedRef.current) {
      deferredRefreshRef.current = true;
      setRefreshPending(true);
      return;
    }
    const sequence = ++requestSequenceRef.current;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}?start=${period.start}&end=${period.end}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || "Could not load staff capacity.");
      if (refreshBlockedRef.current) {
        deferredRefreshRef.current = true;
        setRefreshPending(true);
        return;
      }
      // Replace the complete scoped source snapshot, never merge cached events:
      // deleted/reassigned project sources disappear; retained manual tasks and
      // approved leave still arrive in the authoritative payload.
      setData(() => payload);
      setLastRefreshed(new Date());
      setRefreshPending(false);
      setError("");
    } catch (requestError) {
      if (sequence !== requestSequenceRef.current || controller.signal.aborted || requestError.name === "AbortError") return;
      setError(requestError.message || "Could not load staff capacity.");
    } finally {
      if (sequence === requestSequenceRef.current) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [session?.access_token, period.start, period.end, endpoint]);

  useEffect(() => {
    load();
    return () => {
      requestSequenceRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    if (refreshBlocked && activeRequestRef.current) {
      requestSequenceRef.current += 1;
      activeRequestRef.current.abort();
      activeRequestRef.current = null;
      deferredRefreshRef.current = true;
      setRefreshPending(true);
      setLoading(false);
    } else if (!refreshBlocked && deferredRefreshRef.current) {
      deferredRefreshRef.current = false;
      load();
    }
  }, [refreshBlocked, load]);

  // Both portals reconcile on return; focus + visibility are coalesced. Writers
  // dispatch ec:project-sources-changed after source saves/deletes/reassignments.
  // The matching storage key is just a cross-tab invalidation signal: no source
  // records or event payloads are read into or persisted by this calendar.
  // These signals provide immediate refresh within this browser.
  useEffect(() => {
    const refreshAfterReturn = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastReturnRefreshRef.current < 750) return;
      lastReturnRefreshRef.current = now;
      load();
    };
    const refreshAfterSourceChange = () => load();
    const refreshAfterStorageChange = (event) => {
      if (event.key === "ec:project-sources-changed") load();
    };
    const sourceEvents = ["ec:project-sources-changed", "staff-calendar-source-changed", "staff-capacity-source-changed", "project-activities-updated", "project-schedule-updated"];
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshAfterReturn);
    window.addEventListener("storage", refreshAfterStorageChange);
    sourceEvents.forEach((name) => window.addEventListener(name, refreshAfterSourceChange));
    return () => {
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshAfterReturn);
      window.removeEventListener("storage", refreshAfterStorageChange);
      sourceEvents.forEach((name) => window.removeEventListener(name, refreshAfterSourceChange));
    };
  }, [load]);

  // Another staff member may save from a different device while this calendar
  // remains open. Refresh only the visible signed-in view; load() retains its
  // editor/race guards and defers any refresh until an open edit is finished.
  useEffect(() => {
    if (!session?.access_token) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !activeRequestRef.current) load();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [load, session?.access_token]);

  const saveProfile = async (person) => {
    if (mode === "staff") return;
    const candidate = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: person.id, weeklyCapacityHours: candidate.weeklyCapacityHours, notes: candidate.notes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save contracted hours.");
      setEditing("");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not save contracted hours.");
    } finally {
      setSaving(false);
    }
  };

  // --- Admin: manage any project activity from the calendar ---
  const openUnassignedModal = (event) => {
    if (mode === "staff" || !data?.canEdit) return;
    if (!["activity", "field_survey", "schedule", "milestone"].includes(event.type) || !event.projectId) return;
    const isScheduleItem = ["schedule", "milestone"].includes(event.type);
    const activityId = isScheduleItem ? "" : event.id.replace(/^activity-/, "");
    setModalError("");
    const initial = {
      activityId,
      scheduleItemId: isScheduleItem ? event.id.replace(/^schedule-/, "") : "",
      projectId: event.projectId,
      projectName: event.projectName,
      title: event.title,
      startDate: event.startDate || "",
      dueDate: event.endDate || "",
      staffUserId: event.staffUserId || "",
      taskCategory: event.taskCategory || "",
      detail: event.detail || "",
      budgetHours: event.budgetHours ?? "",
      milestone: event.milestone === true,
    };
    modalInitialRef.current = initial;
    setUnassignedModal(initial);
  };
  const closeCalendarEditor = () => {
    if (modalBusy) return;
    if (calendarEditDirty && !window.confirm("Discard the unsaved calendar changes?")) return;
    setUnassignedModal(null);
    setManualTaskModal(null);
    modalInitialRef.current = null;
  };
  const saveUnassignedAssignment = async () => {
    if (!unassignedModal) return;
    if (!unassignedModal.staffUserId) { setModalError("Choose a staff member, or use Delete if this activity is no longer needed."); return; }
    setModalBusy(true);
    setModalError("");
    try {
      const scheduleAssignment = Boolean(unassignedModal.scheduleItemId);
      const response = await fetch(scheduleAssignment ? endpoint : `/api/projects/${unassignedModal.projectId}/activities/${unassignedModal.activityId}`, {
        method: scheduleAssignment ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(scheduleAssignment ? {
          action: "assign_schedule_item",
          scheduleItemId: unassignedModal.scheduleItemId,
          staffUserId: unassignedModal.staffUserId,
          title: unassignedModal.title,
          startDate: unassignedModal.startDate || undefined,
          dueDate: unassignedModal.dueDate || undefined,
          taskCategory: unassignedModal.taskCategory || undefined,
          detail: unassignedModal.detail || undefined,
          budgetHours: unassignedModal.budgetHours,
          milestone: unassignedModal.milestone,
        } : {
          staffUserId: unassignedModal.staffUserId,
          title: unassignedModal.title,
          startDate: unassignedModal.startDate || undefined,
          dueDate: unassignedModal.dueDate || undefined,
          taskCategory: unassignedModal.taskCategory || undefined,
          detail: unassignedModal.detail || undefined,
          budgetHours: unassignedModal.budgetHours,
          milestone: unassignedModal.milestone,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not assign this activity.");
      setUnassignedModal(null);
      await load();
    } catch (assignError) {
      setModalError(assignError.message || "Could not assign this activity.");
    } finally {
      setModalBusy(false);
    }
  };

  const openManualTaskModal = () => {
    if (mode === "staff" || !data?.canEdit) return;
    setModalError("");
    const initial = {
      itemType: "task",
      assignedTo: "",
      project: "Internal / non-project work",
      task: "",
      startDate: period.start,
      dueDate: period.start,
      budgetHours: "",
      deliverable: "",
      notes: "",
      leaveType: "annual_leave",
    };
    modalInitialRef.current = initial;
    setManualTaskModal(initial);
  };
  const saveManualTask = async () => {
    if (!manualTaskModal) return;
    if (!manualTaskModal.assignedTo) { setModalError("Choose the staff member who will receive this assignment."); return; }
    if (manualTaskModal.itemType !== "leave" && !manualTaskModal.task.trim()) { setModalError("Enter a short task description."); return; }
    if (manualTaskModal.itemType === "leave" && (!manualTaskModal.startDate || !manualTaskModal.dueDate)) { setModalError("Choose the leave start and end dates."); return; }
    setModalBusy(true);
    setModalError("");
    try {
      const isLeave = manualTaskModal.itemType === "leave";
      const response = await fetch(isLeave ? "/api/admin/staff-capacity" : "/api/remote-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(isLeave ? {
          action: "create_approved_leave",
          staffUserId: manualTaskModal.assignedTo,
          leaveType: manualTaskModal.leaveType,
          startDate: manualTaskModal.startDate,
          endDate: manualTaskModal.dueDate,
          note: manualTaskModal.notes,
        } : {
          assigned_to: manualTaskModal.assignedTo,
          project: manualTaskModal.project.trim() || "Internal / non-project work",
          task: manualTaskModal.task.trim(),
          start_date: manualTaskModal.startDate || null,
          due_date: manualTaskModal.dueDate || null,
          budget_hours: manualTaskModal.budgetHours,
          deliverable: manualTaskModal.deliverable,
          notes: manualTaskModal.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (isLeave ? "Could not create the approved leave entry." : "Could not create the manual assignment."));
      setManualTaskModal(null);
      await load();
    } catch (saveError) {
      setModalError(saveError.message || "Could not create the manual assignment.");
    } finally {
      setModalBusy(false);
    }
  };
  const deleteUnassignedActivity = async () => {
    if (!unassignedModal) return;
    if (!window.confirm(`Delete "${unassignedModal.title}"? This can't be undone.`)) return;
    setModalBusy(true);
    setModalError("");
    try {
      const response = await fetch(`/api/projects/${unassignedModal.projectId}/activities?id=${unassignedModal.activityId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete this activity.");
      setUnassignedModal(null);
      await load();
    } catch (deleteError) {
      setModalError(deleteError.message || "Could not delete this activity.");
    } finally {
      setModalBusy(false);
    }
  };

  const beginActivityDrag = (dragEvent, activity) => {
    // Chrome requires populated transfer data before it consistently treats a
    // button as draggable. Keep a native id as a fallback if React state is
    // refreshed between dragstart and drop.
    dragEvent.dataTransfer.effectAllowed = "move";
    dragEvent.dataTransfer.setData("text/plain", String(activity.id || ""));
    dragEvent.dataTransfer.setData("application/x-ecology-activity", JSON.stringify(activity));
    setDraggedActivity(activity);
  };

  const activityFromDrop = (dragEvent) => {
    if (draggedActivity) return draggedActivity;
    try {
      const raw = dragEvent.dataTransfer.getData("application/x-ecology-activity");
      if (raw) return JSON.parse(raw);
    } catch {}
    const id = dragEvent.dataTransfer.getData("text/plain");
    return (data?.calendarEvents || []).find((activity) => activity.id === id) || null;
  };

  // Dragging is the fast planning path: move an activity to a person's row
  // and a new date in one gesture. The click/double-click editor remains the
  // detailed path for reviewing hours, category and activity instructions.
  const dropActivity = async (activity, staffUserId, startDate) => {
    if (!activity || mode === "staff" || !data?.canEdit || !activity.projectId) return;
    if (isNonWorkingDay(startDate)) {
      setDraggedActivity(null);
      setError("Saturday and Sunday are non-working days. Use Add calendar item for a deliberate manual weekend item.");
      return;
    }
    const scheduleAssignment = ["schedule", "milestone"].includes(activity.type);
    const activityId = String(activity.id || "").replace(/^activity-/, "");
    const priorStart = activity.startDate || activity.endDate || startDate;
    const priorEnd = activity.endDate || priorStart;
    const durationDays = Math.max(0, Math.round((new Date(`${priorEnd}T00:00:00Z`) - new Date(`${priorStart}T00:00:00Z`)) / DAY));
    const dueDate = shiftDate(startDate, durationDays);
    setModalError("");
    setError("");
    try {
      const response = await fetch(scheduleAssignment ? endpoint : `/api/projects/${activity.projectId}/activities/${activityId}`, {
        method: scheduleAssignment ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(scheduleAssignment ? {
          action: "assign_schedule_item",
          scheduleItemId: String(activity.id || "").replace(/^schedule-/, ""),
          staffUserId,
          title: activity.title,
          detail: activity.detail || "",
          taskCategory: activity.taskCategory || "",
          budgetHours: activity.budgetHours ?? "",
          startDate,
          dueDate,
          milestone: activity.type === "milestone",
        } : { staffUserId, startDate, dueDate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not move the activity.");
      await load();
    } catch (moveError) {
      setError(moveError.message || "Could not move the activity.");
    } finally {
      setDraggedActivity(null);
    }
  };

  // --- Staff: request unassigned work via a service request ---
  const openClaimRequest = (event) => {
    if (mode !== "staff") return;
    if (!["activity", "field_survey"].includes(event.type) || !event.projectId) return;
    setClaimMessage("");
    setClaimRequest(event);
  };
  const submitClaimRequest = async () => {
    if (!claimRequest) return;
    setClaimBusy(true);
    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          request_type: "task",
          title: `Take on: ${claimRequest.title}`,
          projectId: claimRequest.projectId,
          details: {
            source: "capacity_calendar_unassigned",
            note: `Unassigned work seen on the workload calendar for ${claimRequest.projectName}: "${claimRequest.title}". Requesting this be assigned to me.`,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not submit the service request.");
      setClaimMessage(`Submitted — a service request has been raised to take on "${claimRequest.title}".`);
      setTimeout(() => { setClaimRequest(null); setClaimMessage(""); }, 2500);
    } catch (claimError) {
      setClaimMessage(claimError.message || "Could not submit the service request.");
    } finally {
      setClaimBusy(false);
    }
  };

  const movePeriod = (direction) => {
    if (viewMode === "month") {
      setAnchorDate(shiftMonth(anchorDate, direction));
      return;
    }
    if (viewMode === "year") {
      setAnchorDate(shiftYear(anchorDate, direction));
      return;
    }
    if (viewMode === "range") {
      const length = Math.max(1, Math.round((new Date(`${customEnd}T00:00:00Z`) - new Date(`${customStart}T00:00:00Z`)) / DAY) + 1);
      setCustomStart(shiftDate(customStart, length * direction));
      setCustomEnd(shiftDate(customEnd, length * direction));
      return;
    }
    setAnchorDate(shiftDate(anchorDate, 7 * direction));
  };

  const selectViewMode = (mode) => {
    setViewMode(mode);
    if (mode === "range") {
      setCustomStart(period.start);
      setCustomEnd(period.end);
    }
  };

  const selectedEvents = data?.calendarEvents || [];
  const calendarDays = useMemo(() => {
    const startDate = new Date(`${period.start}T00:00:00.000Z`);
    const endDate = new Date(`${period.end}T00:00:00.000Z`);
    const totalDays = Math.max(0, Math.round((endDate - startDate) / DAY) + 1);
    return Array.from({ length: Math.min(366, totalDays) }, (_, index) => {
      const date = shiftDate(period.start, index);
      return {
        date,
        label: dateText(date, { weekday: "short", day: "numeric" }),
        nonWorking: isNonWorkingDay(date),
        events: selectedEvents.filter((event) => eventFallsOnWorkDay(event, date)),
      };
    });
  }, [period.start, period.end, selectedEvents]);

  const rangeLabel = periodLabel(viewMode, period.start, period.end);

  return (
    <section className={`scp${compact ? " scp--compact" : ""}`} aria-label="Staff Capacity Planner">
      <style>{`
        .scp-modal-backdrop { position: fixed; inset: 0; background: rgba(8,17,13,.55); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
        .scp-modal { background: #fdfbf6; border-radius: 14px; padding: 22px; width: 100%; max-width: 560px; box-shadow: 0 30px 60px -20px rgba(6,18,12,.5); }
        .scp-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .scp-modal-head span { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #6b755f; }
        .scp-modal-head h3 { margin: 4px 0 0; font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 19px; color: #12211a; }
        .scp-modal-head button { background: none; border: none; color: #8a927c; cursor: pointer; padding: 4px; }
        .scp-modal p { font-size: 13px; line-height: 1.55; color: #3a4740; margin: 0 0 14px; }
        .scp-modal-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; color: #3a4740; margin-bottom: 12px; }
        .scp-modal-field input, .scp-modal-field select, .scp-modal-field textarea { width: 100%; box-sizing: border-box; font-family: inherit; font-weight: 400; font-size: 13.5px; border: 1px solid #cdd8c6; border-radius: 8px; padding: 9px 11px; color: #1c3023; background: #fff; }
        .scp-modal-field textarea { resize: vertical; min-height: 76px; }
        .scp-modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .scp-modal-context { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0 0 14px; }
        .scp-modal-context div { min-width: 0; border: 1px solid #dce4d8; border-radius: 7px; padding: 7px 9px; background: #f5f9f1; }
        .scp-modal-context span { display: block; margin-bottom: 2px; color: #6b755f; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        .scp-modal-context strong { display: block; overflow: hidden; color: #173523; font-size: 12px; line-height: 1.32; text-overflow: ellipsis; white-space: nowrap; }
        .scp-modal-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; }
        .scp-modal-delete { display: inline-flex; align-items: center; gap: 6px; background: #fef4f2; color: #a5342a; border: 1px solid rgba(196,69,58,.3); border-radius: 8px; padding: 9px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .scp-modal-save { display: inline-flex; align-items: center; gap: 6px; background: #1f5a34; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer; margin-left: auto; }
        .scp-modal-save:disabled { opacity: .6; cursor: not-allowed; }
        .scp-success { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #2c6a34; background: #eef6ea; border: 1px solid rgba(44,106,52,.25); border-radius: 8px; padding: 9px 12px; margin-bottom: 12px; }
        @media (max-width: 640px) {
          .scp-modal-row, .scp-modal-context { grid-template-columns: 1fr; }
        }
      `}</style>
      <header className="scp-head">
        <div>
          <span><Users size={14} /> Delivery planning · live workload view</span>
          <h2>Staff Capacity Planner</h2>
          <p>{mode === "staff" ? "See the team's planned work, approved leave and project deadlines on the calendar below." : "Review allocated activity hours, approved leave, project deadlines and available capacity before creating or reassigning work."}</p>
        </div>
        <div className="scp-controls">
          <button type="button" className="scp-refresh" onClick={() => load()} disabled={loading} title="Reload the latest workload dates">
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          <label className="scp-view-select">
            <span>Workload period</span>
            <select value={viewMode} onChange={(event) => selectViewMode(event.target.value)} aria-label="Workload period">
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="range">Date range</option>
            </select>
          </label>
          {viewMode === "range" ? (
            <div className="scp-range-fields">
              <label><span>From</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label><span>To</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
            </div>
          ) : viewMode === "month" ? (
            <label className="scp-period-input"><span>Month</span><input type="month" value={anchorDate.slice(0, 7)} onChange={(event) => setAnchorDate(`${event.target.value}-01`)} /></label>
          ) : viewMode === "year" ? (
            <label className="scp-period-input"><span>Year</span><input type="number" min="2000" max="2100" value={anchorDate.slice(0, 4)} onChange={(event) => setAnchorDate(`${event.target.value}-01-01`)} /></label>
          ) : null}
          <div className="scp-period">
            <button type="button" aria-label={`Previous ${viewMode}`} onClick={() => movePeriod(-1)}><ChevronLeft size={16} /></button>
            <strong>{rangeLabel}</strong>
            <button type="button" aria-label={`Next ${viewMode}`} onClick={() => movePeriod(1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </header>

      {error ? <p className="scp-error"><AlertTriangle size={15} /> {error}</p> : null}
      {loading ? <p className="scp-loading"><Loader2 className="spin" size={16} /> Calculating capacity…</p> : null}
      {!loading && data?.ready === false ? <p className="scp-error"><AlertTriangle size={15} /> {data.message}</p> : null}
      {lastRefreshed ? <p className="scp-refresh-status" aria-live="polite" style={{ fontSize: "11px", color: "#a9c4a9", margin: "0 0 10px" }}>Last refreshed {lastRefreshed.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}{refreshPending ? " · Updates pending — save or close the editor to refresh." : ""}</p> : null}

      {data?.ready ? (
        <>
          {mode !== "staff" && (
            <>
              <div className="scp-legend">
                {Object.entries(STATUS).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}
              </div>
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead><tr><th>Staff member</th><th>Capacity</th><th>Contracted hours</th><th>Available hours</th><th>Allocated hours</th><th>Leave</th><th>Projects</th><th>Due</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {data.people.map((person) => {
                      const status = STATUS[person.status] || STATUS.available;
                      const profile = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
                      return <Fragment key={person.id}>
                        <tr className={person.status === "over_capacity" ? "over" : ""}>
                          <td><strong>{person.name || person.email}</strong><small>{person.email}</small></td>
                          <td><div className="scp-meter"><i style={{ width: `${Math.min(100, person.capacityPercent)}%`, background: status.color }} /><span>{person.capacityPercent}%</span></div></td>
                          <td><strong>{person.weeklyCapacityHours} h</strong><small>per week</small></td>
                          <td>{person.availableHours} h{person.capacityIncomplete ? <small> · known effort only</small> : null}</td><td>{person.allocatedHours} h{person.unknownAllocationCount ? <small> + {person.unknownAllocationCount} TBC</small> : null}</td><td>{person.leaveDays ? `${person.leaveDays} day${person.leaveDays === 1 ? "" : "s"}` : "—"}</td><td>{person.activeProjectCount}</td><td>{person.upcomingDueCount}</td>
                          <td><span className="scp-status" style={{ color: status.color, borderColor: `${status.color}66`, background: `${status.color}14` }}>{status.label}</span></td>
                          <td>{data.canEdit ? <button type="button" className="scp-edit" onClick={() => {
                          if (editing === person.id && capacityDirty && !window.confirm("Discard the unsaved capacity change for this person?")) return;
                          setEditing(editing === person.id ? "" : person.id);
                          setDraft({ ...draft, [person.id]: profile });
                        }} title="Edit contracted weekly hours"><Edit3 size={14} /></button> : null}</td>
                        </tr>
                        {editing === person.id ? <tr><td className="scp-profile" colSpan={10}><div className="scp-profile-fields"><label>Contracted weekly hours <input type="number" min="0" max="168" step="0.5" value={profile.weeklyCapacityHours} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, weeklyCapacityHours: event.target.value } })} /></label><label>Capacity notes <input value={profile.notes} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, notes: event.target.value } })} placeholder="Optional availability note" /></label><button type="button" disabled={saving} onClick={() => saveProfile(person)}>{saving ? "Saving…" : "Save contracted hours"}</button></div></td></tr> : null}
                      </Fragment>;
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

              <div className="scp-calendar-section">
              <div className="scp-calendar-heading"><div><h3><CalendarDays size={16} /> Workload calendar</h3><p>Date ranges spread planned effort over working days and are not a booking for every day. Saturday and Sunday are non-working days: project tasks and automatic reviews do not book weekends. Use Add calendar item for a deliberate manual weekend item. Click or double-click a project item for context. Administrators can drag an activity or unassigned schedule item to a staff member and date; the linked delivery schedule updates automatically.</p></div><div className="scp-calendar-heading-actions">{mode !== "staff" && data.canEdit ? <button type="button" className="scp-manual-task" onClick={openManualTaskModal}><UserPlus size={14} /> Add calendar item</button> : null}<span className="scp-calendar-count">{calendarDays.length} day{calendarDays.length === 1 ? "" : "s"}</span></div></div>
            <div className="scp-calendar-legend">{Object.entries(EVENT).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
            {selectedEvents.length ? (
              <>
              <div className="scp-calendar-scroll" role="region" aria-label="Workload calendar scroll area" tabIndex="0">
                <div className="scp-calendar-grid" role="grid" aria-label={`${rangeLabel} staff workload calendar`} style={{ "--scp-day-count": calendarDays.length }}>
                  <div className="scp-calendar-corner" role="columnheader">Staff member</div>
                  {calendarDays.map((day) => <div className={`scp-calendar-day-header${day.nonWorking ? " scp-calendar-day-header--non-working" : ""}`} role="columnheader" key={day.date}><strong>{day.label}</strong><small>{day.date.slice(0, 4)}</small>{day.nonWorking ? <span className="scp-calendar-non-working-label">Non-working</span> : null}</div>)}
                  {data.people.map((person) => <div className="scp-calendar-person-row" role="row" key={`calendar-${person.id}`}>
                    <div className="scp-calendar-staff" role="rowheader" onClick={() => onSelectStaff?.(person)}><strong>{person.name || person.email}</strong><small>{person.weeklyCapacityHours} h/wk</small></div>
                    {calendarDays.map((day) => {
                      const events = day.events.filter((event) => event.staffUserId === person.id);
                      const canReceiveDrop = mode !== "staff" && data.canEdit && !day.nonWorking;
                      return <div className={`scp-calendar-cell${day.nonWorking ? " scp-calendar-cell--non-working" : ""}${draggedActivity && canReceiveDrop ? " scp-calendar-cell--drop-target" : ""}`} role="gridcell" aria-label={day.nonWorking ? `${person.name || person.email} · ${day.date} · Non-working day; manual items only` : undefined} key={`${person.id}-${day.date}`} onDragOver={(event) => { if (canReceiveDrop) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (!canReceiveDrop) { if (day.nonWorking && mode !== "staff" && data.canEdit) setError("Saturday and Sunday are non-working days. Use Add calendar item for a deliberate manual weekend item."); setDraggedActivity(null); return; } dropActivity(activityFromDrop(event), person.id, day.date); }}>
                        {events.map((event, index) => { const style = EVENT[event.type] || EVENT.schedule; const manageable = ["activity", "field_survey", "schedule", "milestone"].includes(event.type) && event.projectId && mode !== "staff" && data.canEdit; return <button type="button" draggable={manageable} className={`scp-calendar-event${manageable ? " scp-calendar-event--draggable" : ""}${day.nonWorking && event.type === "task_brief" ? " scp-calendar-event--weekend-manual" : ""}`} key={`${event.type}-${event.id}-${person.id}-${index}`} onDragStart={(dragEvent) => { if (manageable) beginActivityDrag(dragEvent, event); }} onDragEnd={() => setDraggedActivity(null)} onClick={() => manageable ? openUnassignedModal(event) : onSelectStaff?.(person)} onDoubleClick={() => manageable && openUnassignedModal(event)} title={manageable ? `${event.title} — click for details, or drag to reassign and reschedule` : `${event.title}${event.projectName ? ` · ${event.projectName}` : ""}`}><i style={{ background: style.color }} /><span>{event.title}{event.hoursTbc ? " · TBC hours" : ""}{day.nonWorking && event.type === "task_brief" ? <small className="scp-weekend-manual-label">Manual weekend</small> : null}</span></button>; })}
                      </div>;
                    })}
                  </div>)}
                  {calendarDays.some((day) => day.events.some((event) => !event.staffUserId)) ? <div className="scp-calendar-person-row" role="row" key="calendar-shared">
                    <div className="scp-calendar-staff scp-calendar-staff--shared" role="rowheader"><strong>Shared / unassigned</strong><small>Project-wide items</small></div>
                    {calendarDays.map((day) => <div className={`scp-calendar-cell${day.nonWorking ? " scp-calendar-cell--non-working" : ""}${draggedActivity && mode !== "staff" && data.canEdit && !day.nonWorking ? " scp-calendar-cell--drop-target" : ""}`} role="gridcell" aria-label={day.nonWorking ? `${day.date} · Non-working day; manual items only` : undefined} key={`shared-${day.date}`} onDragOver={(event) => { if (mode !== "staff" && data.canEdit && !day.nonWorking) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (day.nonWorking || mode === "staff" || !data.canEdit) { if (day.nonWorking && mode !== "staff" && data.canEdit) setError("Saturday and Sunday are non-working days. Use Add calendar item for a deliberate manual weekend item."); setDraggedActivity(null); return; } const activity = activityFromDrop(event); if (activity) openUnassignedModal({ ...activity, startDate: day.date, endDate: day.date, staffUserId: "" }); }}>{day.events.filter((event) => !event.staffUserId).map((event, index) => {
                      const style = EVENT[event.type] || EVENT.schedule;
                      const manageable = ["activity", "field_survey", "schedule", "milestone"].includes(event.type) && event.projectId;
                      return (
                        <button
                          type="button"
                          className={`scp-calendar-event${manageable && mode !== "staff" && data.canEdit ? " scp-calendar-event--draggable" : ""}${day.nonWorking && event.type === "task_brief" ? " scp-calendar-event--weekend-manual" : ""}`}
                          key={`${event.type}-${event.id}-shared-${index}`}
                          draggable={manageable && mode !== "staff" && data.canEdit}
                          title={manageable ? (mode === "staff" ? `${event.title} — click to request this work` : `${event.title} — click for details, or drag onto a staff member and date`) : event.title}
                          onDragStart={(dragEvent) => { if (manageable && mode !== "staff" && data.canEdit) beginActivityDrag(dragEvent, event); }}
                          onDragEnd={() => setDraggedActivity(null)}
                          onDoubleClick={() => manageable && mode !== "staff" && openUnassignedModal(event)}
                          onClick={() => { if (manageable && mode === "staff") openClaimRequest(event); else if (manageable && mode !== "staff") openUnassignedModal(event); }}
                          style={{ cursor: manageable ? "pointer" : "default" }}
                        >
                          <i style={{ background: style.color }} /><span>{event.title}{event.hoursTbc ? " · TBC hours" : ""}{day.nonWorking && event.type === "task_brief" ? <small className="scp-weekend-manual-label">Manual weekend</small> : null}</span>
                        </button>
                      );
                    })}</div>)}
                  </div> : null}
                </div>
              </div>

              {unassignedModal ? (
                <div className="scp-modal-backdrop" role="dialog" aria-label="Manage project activity" onClick={closeCalendarEditor}>
                  <div className="scp-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="scp-modal-head">
                      <div>
                        <span>{unassignedModal.projectName}</span>
                        <h3>Assign or reschedule activity</h3>
                      </div>
                      <button type="button" aria-label="Close calendar editor" onClick={closeCalendarEditor}><X size={16} /></button>
                    </div>
                    {modalError ? <p className="scp-error"><AlertTriangle size={14} /> {modalError}</p> : null}
                    <p>Changes apply to this work activity. A linked auto-generated Gantt item is updated at the same time; manually created schedule phases are retained.</p>
                    <div className="scp-modal-context">
                      <div><span>Project</span><strong>{unassignedModal.projectName || "Project"}</strong></div>
                      <div><span>Activity</span><strong>{unassignedModal.title || "Untitled activity"}</strong></div>
                      <div><span>Category</span><strong>{unassignedModal.taskCategory || "Not categorised"}</strong></div>
                      <div><span>Budgeted effort</span><strong>{unassignedModal.budgetHours === "" ? "TBC" : `${unassignedModal.budgetHours} hours`}</strong></div>
                    </div>
                    <label className="scp-modal-field">
                      Title
                      <input value={unassignedModal.title} onChange={(event) => setUnassignedModal({ ...unassignedModal, title: event.target.value })} />
                    </label>
                    <div className="scp-modal-row">
                      <label className="scp-modal-field">Start date<input type="date" value={unassignedModal.startDate} onChange={(event) => setUnassignedModal({ ...unassignedModal, startDate: event.target.value })} /></label>
                      <label className="scp-modal-field">Due date<input type="date" value={unassignedModal.dueDate} onChange={(event) => setUnassignedModal({ ...unassignedModal, dueDate: event.target.value })} /></label>
                    </div>
                    <label className="scp-modal-field">
                      Assign to
                      <select value={unassignedModal.staffUserId} onChange={(event) => setUnassignedModal({ ...unassignedModal, staffUserId: event.target.value })}>
                        <option value="">Select a staff member…</option>
                        {(data.people || []).map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                      </select>
                    </label>
                    <div className="scp-modal-row">
                      <label className="scp-modal-field">Work category<input value={unassignedModal.taskCategory} onChange={(event) => setUnassignedModal({ ...unassignedModal, taskCategory: event.target.value })} placeholder="e.g. Fieldwork & Travel" /></label>
                      <label className="scp-modal-field">Budgeted hours<input type="number" min="0" step="0.25" value={unassignedModal.budgetHours} onChange={(event) => setUnassignedModal({ ...unassignedModal, budgetHours: event.target.value })} /></label>
                    </div>
                    <label className="scp-modal-field">Activity details<textarea rows={3} value={unassignedModal.detail} onChange={(event) => setUnassignedModal({ ...unassignedModal, detail: event.target.value })} placeholder="Scope, fieldwork instructions, handover requirements or dependencies" /></label>
                    <div className="scp-modal-actions">
                      {!unassignedModal.scheduleItemId ? <button type="button" className="scp-modal-delete" disabled={modalBusy} onClick={deleteUnassignedActivity}><Trash2 size={14} /> Delete</button> : null}
                      <button type="button" className="scp-modal-save" disabled={modalBusy} onClick={saveUnassignedAssignment}>
                        {modalBusy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {modalBusy ? "Saving…" : unassignedModal.staffUserId ? "Save activity & notify" : "Assign & notify"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {manualTaskModal ? (
                <div className="scp-modal-backdrop" role="dialog" aria-label="Add calendar item" onClick={closeCalendarEditor}>
                  <div className="scp-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="scp-modal-head"><div><span>Workload calendar</span><h3>Add calendar item</h3></div><button type="button" aria-label="Close calendar editor" onClick={closeCalendarEditor}><X size={16} /></button></div>
                    {modalError ? <p className="scp-error"><AlertTriangle size={14} /> {modalError}</p> : null}
                    <p>{manualTaskModal.itemType === "leave" ? "Record administrator-approved leave directly in the calendar. It reduces capacity immediately and creates a staff-owned approved leave record." : "Use this for policy reviews, operational work and other non-project tasks. The assignee receives a Staff Portal notification and the task appears in the workload calendar immediately."}</p>
                    <fieldset className="scp-calendar-item-type">
                      <legend className="scp-calendar-item-type__heading">Calendar item type</legend>
                      <div className="scp-calendar-item-type__choices">
                        <label><input type="radio" name="calendar-item-type" checked={manualTaskModal.itemType === "task"} onChange={() => setManualTaskModal({ ...manualTaskModal, itemType: "task" })} /> Manual task</label>
                        <label><input type="radio" name="calendar-item-type" checked={manualTaskModal.itemType === "leave"} onChange={() => setManualTaskModal({ ...manualTaskModal, itemType: "leave" })} /> Approved leave</label>
                      </div>
                    </fieldset>
                    <label className="scp-modal-field">Assign to<select value={manualTaskModal.assignedTo} onChange={(event) => setManualTaskModal({ ...manualTaskModal, assignedTo: event.target.value })}><option value="">Select a staff member…</option>{(data.people || []).map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}</select></label>
                    {manualTaskModal.itemType === "leave" ? <>
                      <label className="scp-modal-field">Leave type<select value={manualTaskModal.leaveType} onChange={(event) => setManualTaskModal({ ...manualTaskModal, leaveType: event.target.value })}><option value="annual_leave">Annual leave</option><option value="personal_carers_leave">Personal / carer’s leave</option><option value="long_service_leave">Long service leave</option><option value="parental_leave">Parental leave</option><option value="unpaid_leave">Unpaid leave</option><option value="other_leave">Other leave</option></select></label>
                      <div className="scp-modal-row"><label className="scp-modal-field">Leave start<input type="date" value={manualTaskModal.startDate} onChange={(event) => setManualTaskModal({ ...manualTaskModal, startDate: event.target.value })} /></label><label className="scp-modal-field">Leave end<input type="date" value={manualTaskModal.dueDate} onChange={(event) => setManualTaskModal({ ...manualTaskModal, dueDate: event.target.value })} /></label></div>
                      <label className="scp-modal-field">Administrator note<textarea rows={3} value={manualTaskModal.notes} onChange={(event) => setManualTaskModal({ ...manualTaskModal, notes: event.target.value })} placeholder="Optional leave context or cover arrangement" /></label>
                    </> : <>
                      <label className="scp-modal-field">Workstream or project<input value={manualTaskModal.project} onChange={(event) => setManualTaskModal({ ...manualTaskModal, project: event.target.value })} placeholder="e.g. Internal / non-project work" /></label>
                      <label className="scp-modal-field">Task description<input value={manualTaskModal.task} onChange={(event) => setManualTaskModal({ ...manualTaskModal, task: event.target.value })} placeholder="e.g. Review biodiversity policy update" /></label>
                      <div className="scp-modal-row"><label className="scp-modal-field">Start date<input type="date" value={manualTaskModal.startDate} onChange={(event) => setManualTaskModal({ ...manualTaskModal, startDate: event.target.value })} /></label><label className="scp-modal-field">Due date<input type="date" value={manualTaskModal.dueDate} onChange={(event) => setManualTaskModal({ ...manualTaskModal, dueDate: event.target.value })} /></label></div>
                      {calendarDayPolicy(manualTaskModal.startDate, manualTaskModal.dueDate, true) === "calendar_days" ? <p className="scp-manual-weekend-notice" role="status"><strong>Manual weekend item.</strong> This item will appear on the shaded non-working day. Normal project tasks remain Monday–Friday.</p> : null}
                      <div className="scp-modal-row"><label className="scp-modal-field">Planned hours<input type="number" min="0" step="0.25" value={manualTaskModal.budgetHours} onChange={(event) => setManualTaskModal({ ...manualTaskModal, budgetHours: event.target.value })} /></label><label className="scp-modal-field">Deliverable / outcome<input value={manualTaskModal.deliverable} onChange={(event) => setManualTaskModal({ ...manualTaskModal, deliverable: event.target.value })} placeholder="Optional" /></label></div>
                      <label className="scp-modal-field">Instructions or links<textarea rows={3} value={manualTaskModal.notes} onChange={(event) => setManualTaskModal({ ...manualTaskModal, notes: event.target.value })} placeholder="Brief, context and any handover requirements" /></label>
                    </>}
                    <div className="scp-modal-actions"><button type="button" className="scp-modal-save" disabled={modalBusy} onClick={saveManualTask}>{modalBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {modalBusy ? (manualTaskModal.itemType === "leave" ? "Adding leave…" : "Assigning…") : (manualTaskModal.itemType === "leave" ? "Add approved leave & notify" : "Assign & notify")}</button></div>
                  </div>
                </div>
              ) : null}

              {claimRequest ? (
                <div className="scp-modal-backdrop" role="dialog" aria-label="Request unassigned work" onClick={() => !claimBusy && setClaimRequest(null)}>
                  <div className="scp-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="scp-modal-head">
                      <div>
                        <span>{claimRequest.projectName}</span>
                        <h3>{claimRequest.title}</h3>
                      </div>
                      <button type="button" onClick={() => !claimBusy && setClaimRequest(null)}><X size={16} /></button>
                    </div>
                    <p>This work isn't assigned to anyone yet. Submit a service request asking to take it on — an administrator will review it.</p>
                    {claimMessage ? <p className={claimMessage.startsWith("Submitted") ? "scp-success" : "scp-error"}>{claimMessage.startsWith("Submitted") ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {claimMessage}</p> : null}
                    <div className="scp-modal-actions">
                      <button type="button" className="scp-modal-save" disabled={claimBusy || claimMessage.startsWith("Submitted")} onClick={submitClaimRequest}>
                        {claimBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {claimBusy ? "Submitting…" : "Submit service request"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              </>
            ) : <p className="scp-empty"><CheckCircle2 size={16} /> No planned workload or approved leave in this period.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
