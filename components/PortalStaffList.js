"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Search, Users2, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const blankDraft = { firstName: "", lastName: "", phone: "", active: true };

function fullName(person) {
  return (
    `${person?.firstName || ""} ${person?.lastName || ""}`.trim() ||
    person?.name ||
    person?.email ||
    "Staff member"
  );
}

export default function PortalStaffList() {
  const { session } = useAuth();
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [openId, setOpenId] = useState("");
  const [draft, setDraft] = useState(blankDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    }),
    [session?.access_token],
  );
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/staff", {
        headers: headers(),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body?.error || "Could not load the Staff List.");
      setStaff(Array.isArray(body.staff) ? body.staff : []);
    } catch (requestError) {
      setError(requestError.message || "Could not load the Staff List.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return staff.filter((person) => {
      if (filter === "active" && person.active === false) return false;
      if (filter === "unavailable" && person.active !== false) return false;
      if (!needle) return true;
      return [fullName(person), person.email, person.phone].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(needle),
      );
    });
  }, [filter, query, staff]);

  const beginEdit = (person) => {
    setOpenId(person.id);
    setDraft({
      firstName: person.firstName || "",
      lastName: person.lastName || "",
      phone: person.phone || "",
      active: person.active !== false,
    });
    setError("");
    setNotice("");
  };
  const save = async (person) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ id: person.id, ...draft }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body?.error || "Could not save the staff record.");
      setStaff((current) =>
        current.map((item) =>
          item.id === person.id ? { ...item, ...body.staff } : item,
        ),
      );
      setOpenId("");
      setNotice(
        `${fullName(body.staff)} updated. Assignment menus now use this directory record.`,
      );
    } catch (requestError) {
      setError(requestError.message || "Could not save the staff record.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="staff-list" aria-label="Staff List">
      <header className="staff-list__hero">
        <div>
          <span className="pm-kicker">Authoritative assignment directory</span>
          <h2>
            <Users2 size={20} /> Staff List
          </h2>
          <p>
            Maintain the names, work emails, phone numbers and allocation
            availability used when assigning project work, tracker activities,
            task briefs and role responsibilities. Create new accounts in Access
            & administrator control.
          </p>
        </div>
        <div className="staff-list__count">
          <strong>
            {staff.filter((person) => person.active !== false).length}
          </strong>
          <span>available for allocation</span>
        </div>
      </header>

      {error ? (
        <div className="pm-notice error">
          <X size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="pm-notice success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
        </div>
      ) : null}
      <div className="staff-list__toolbar">
        <label className="staff-list__search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email or phone"
          />
        </label>
        <label>
          <span>Show</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="active">Available for allocation</option>
            <option value="all">All staff records</option>
            <option value="unavailable">Unavailable for allocation</option>
          </select>
        </label>
      </div>

      <section className="staff-list__table-wrap">
        <table className="staff-list__table">
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Work email</th>
              <th>Phone</th>
              <th>Assignment availability</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="staff-list__empty">
                  Loading controlled staff directory…
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="staff-list__empty">
                  No staff records match the current directory view.
                </td>
              </tr>
            ) : null}
            {!loading &&
              rows.map((person) => {
                const editing = openId === person.id;
                return (
                  <tr
                    key={person.id}
                    className={person.active === false ? "is-unavailable" : ""}
                  >
                    <td>
                      {editing ? (
                        <div className="staff-list__names">
                          <input
                            aria-label="First name"
                            value={draft.firstName}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                firstName: event.target.value,
                              })
                            }
                            placeholder="First name"
                          />
                          <input
                            aria-label="Last name"
                            value={draft.lastName}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                lastName: event.target.value,
                              })
                            }
                            placeholder="Last name"
                          />
                        </div>
                      ) : (
                        <strong>{fullName(person)}</strong>
                      )}
                    </td>
                    <td>{person.email}</td>
                    <td>
                      {editing ? (
                        <input
                          className="staff-list__phone"
                          aria-label="Phone"
                          value={draft.phone}
                          onChange={(event) =>
                            setDraft({ ...draft, phone: event.target.value })
                          }
                          placeholder="e.g. 04xx xxx xxx"
                        />
                      ) : (
                        person.phone || (
                          <span className="staff-list__muted">
                            Not recorded
                          </span>
                        )
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <label className="staff-list__availability">
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                active: event.target.checked,
                              })
                            }
                          />{" "}
                          Available for allocation
                        </label>
                      ) : (
                        <span
                          className={`staff-list__status ${person.active === false ? "unavailable" : "available"}`}
                        >
                          {person.active === false
                            ? "Unavailable"
                            : "Available"}
                        </span>
                      )}
                    </td>
                    <td className="staff-list__actions">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="staff-list__save"
                            disabled={saving}
                            onClick={() => save(person)}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="staff-list__cancel"
                            onClick={() => setOpenId("")}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="staff-list__edit"
                          onClick={() => beginEdit(person)}
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
      <p className="staff-list__footnote">
        Marking a person unavailable removes them from new allocation dropdowns.
        It does not delete their account, change administrator access or remove
        historic project records.
      </p>
    </section>
  );
}
