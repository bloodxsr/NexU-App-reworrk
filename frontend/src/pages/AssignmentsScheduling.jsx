import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/useAuth';
import { useTeacherAccess } from '../hooks/useTeacherAccess';
import { assignmentApi, scheduleApi } from '../lib/localBase';
import './Page.css';

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toLocalDateKey = (dateLike = new Date()) => {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

export default function AssignmentsScheduling() {
    const { user, profile, loading: authLoading, profileError, isTeacher, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const canEdit = isTeacher || isAdmin;

    // For teachers: which class are they managing?
    const { teacherAccess } = useTeacherAccess(user, isTeacher);
    const allowedClasses = teacherAccess?.allowed_classes || [];

    // Class selection for teachers/admins
    const [selectedField, setSelectedField] = useState('');
    const [selectedSemester, setSelectedSemester] = useState('');
    const [selectedSection, setSelectedSection] = useState('');

    // For students: derive class from profile
    const classField = canEdit ? selectedField : (profile?.field_of_study || '');
    const classSemester = canEdit ? selectedSemester : (profile?.semester || '');
    const classSection = canEdit ? selectedSection : (profile?.section || '');
    const hasClass = classField && classSemester && classSection;

    // Form state
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDesc, setTaskDesc] = useState('');
    const [taskDueDate, setTaskDueDate] = useState('');
    const [taskSubject, setTaskSubject] = useState('');

    const [classTitle, setClassTitle] = useState('');
    const [classDay, setClassDay] = useState('Monday');
    const [classSlot, setClassSlot] = useState('09:00 - 10:00');
    const [classLocation, setClassLocation] = useState('');
    const [classSubject, setClassSubject] = useState('');
    const [calendarMonth, setCalendarMonth] = useState(new Date());

    // Auto-select first allowed class for teachers
    useState(() => {
        if (canEdit && allowedClasses.length > 0 && !selectedField) {
            const first = allowedClasses[0];
            setSelectedField(first.field_of_study);
            setSelectedSemester(first.semester);
            setSelectedSection(first.section);
        }
    });

    const assignmentsQuery = useQuery({
        queryKey: ['assignments', classField, classSemester, classSection],
        enabled: !!user && !!hasClass,
        queryFn: () => assignmentApi.listByClass(classField, classSemester, classSection),
    });

    const scheduleQuery = useQuery({
        queryKey: ['schedule', classField, classSemester, classSection],
        enabled: !!user && !!hasClass,
        queryFn: () => scheduleApi.listByClass(classField, classSemester, classSection),
    });

    const createAssignment = useMutation({
        mutationFn: async () => {
            await assignmentApi.create({
                field_of_study: classField,
                semester: classSemester,
                section: classSection,
                title: taskTitle.trim(),
                description: taskDesc.trim(),
                due_date: taskDueDate,
                subject: taskSubject.trim() || undefined,
            });
        },
        onSuccess: () => {
            setTaskTitle('');
            setTaskDesc('');
            setTaskDueDate('');
            setTaskSubject('');
            queryClient.invalidateQueries({ queryKey: ['assignments'] });
        },
    });

    const createSchedule = useMutation({
        mutationFn: async () => {
            await scheduleApi.create({
                field_of_study: classField,
                semester: classSemester,
                section: classSection,
                title: classTitle.trim(),
                day: classDay,
                slot: classSlot.trim(),
                location: classLocation.trim(),
                subject: classSubject.trim() || undefined,
            });
        },
        onSuccess: () => {
            setClassTitle('');
            setClassSlot('09:00 - 10:00');
            setClassLocation('');
            setClassSubject('');
            queryClient.invalidateQueries({ queryKey: ['schedule'] });
        },
    });

    const removeSchedule = useMutation({
        mutationFn: async (id) => scheduleApi.remove(id, classField, classSemester, classSection),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedule'] });
        },
    });

    const assignments = assignmentsQuery.data ?? [];
    const schedule = scheduleQuery.data ?? [];

    const deadlineMap = useMemo(() => {
        const map = new Map();
        assignments.forEach((item) => {
            if (!item.due_date) return;
            map.set(item.due_date, (map.get(item.due_date) || 0) + 1);
        });
        return map;
    }, [assignments]);

    const calendarDays = useMemo(() => {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();

        const cells = [];
        for (let i = 0; i < startPadding; i += 1) cells.push(null);
        for (let d = 1; d <= lastDay.getDate(); d += 1) {
            const date = new Date(year, month, d);
            const iso = toLocalDateKey(date);
            cells.push({ day: d, iso, count: deadlineMap.get(iso) || 0 });
        }
        return cells;
    }, [calendarMonth, deadlineMap]);

    // Group schedule by day for timetable display
    const scheduleByDay = useMemo(() => {
        const byDay = {};
        for (const day of WEEK_DAYS) byDay[day] = [];
        for (const slot of schedule) {
            if (byDay[slot.day]) byDay[slot.day].push(slot);
        }
        // Sort each day's slots by time
        for (const day of WEEK_DAYS) {
            byDay[day].sort((a, b) => a.slot.localeCompare(b.slot));
        }
        return byDay;
    }, [schedule]);

    if (authLoading) return <div className="page-container">Loading...</div>;
    if (!user) return <Navigate to="/login" />;
    if (profileError) return <div className="page-container">{profileError}</div>;

    const handleClassSelect = (e) => {
        const [f, s, sec] = e.target.value.split('|');
        setSelectedField(f || '');
        setSelectedSemester(s || '');
        setSelectedSection(sec || '');
    };

    return (
        <div className="page-container">
            <div className="page-content" style={{ maxWidth: '1100px' }}>
                <h1>Assignments & Timetable</h1>
                <p style={{ color: 'var(--color-gray)', marginBottom: '1.5rem' }}>
                    {canEdit
                        ? 'Manage class timetables and assignments. Students in the selected class will see these automatically.'
                        : 'Your class timetable, assignments, and deadline calendar.'}
                </p>

                {/* Class selector for teachers/admins */}
                {canEdit && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '0.4rem' }}>
                            Managing Class
                        </label>
                        <select
                            value={`${selectedField}|${selectedSemester}|${selectedSection}`}
                            onChange={handleClassSelect}
                            style={{ minWidth: '240px' }}
                        >
                            <option value="||">— Select a class —</option>
                            {allowedClasses.map((c, i) => (
                                <option key={i} value={`${c.field_of_study}|${c.semester}|${c.section}`}>
                                    {c.field_of_study} — Sem {c.semester} — Sec {c.section}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {!hasClass && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#888', border: '1px solid #333' }}>
                        {canEdit ? 'Select a class above to manage its timetable and assignments.' : 'No class assigned to your profile.'}
                    </div>
                )}

                {hasClass && (
                    <>
                        {/* Current class label for students */}
                        {!canEdit && (
                            <div style={{ marginBottom: '1.5rem', fontSize: '0.85rem', color: '#888' }}>
                                Class: <strong style={{ color: '#fff' }}>{classField} — Sem {classSemester} — Sec {classSection}</strong>
                            </div>
                        )}

                        {/* ── Create forms (teachers/admins only) ── */}
                        {canEdit && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.2rem', marginBottom: '1.5rem' }}>
                                <section className="tech-highlight">
                                    <h2 style={{ marginTop: 0 }}>Add Assignment</h2>
                                    <div className="form-group">
                                        <label>Title</label>
                                        <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Physics worksheet" />
                                    </div>
                                    <div className="form-group">
                                        <label>Subject (optional)</label>
                                        <input value={taskSubject} onChange={(e) => setTaskSubject(e.target.value)} placeholder="e.g. Applied Physics I" />
                                    </div>
                                    <div className="form-group">
                                        <label>Description</label>
                                        <input value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} placeholder="Optional details" />
                                    </div>
                                    <div className="form-group">
                                        <label>Due Date</label>
                                        <input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} />
                                    </div>
                                    <button
                                        className="auth-submit"
                                        onClick={() => createAssignment.mutate()}
                                        disabled={!taskTitle.trim() || !taskDueDate || createAssignment.isPending}
                                    >
                                        {createAssignment.isPending ? 'Saving...' : 'Add Assignment'}
                                    </button>
                                </section>

                                <section className="tech-highlight">
                                    <h2 style={{ marginTop: 0 }}>Add Schedule Slot</h2>
                                    <div className="form-group">
                                        <label>Class/Subject Name</label>
                                        <input value={classTitle} onChange={(e) => setClassTitle(e.target.value)} placeholder="e.g. Chemistry Lab" />
                                    </div>
                                    <div className="form-group">
                                        <label>Subject (optional)</label>
                                        <input value={classSubject} onChange={(e) => setClassSubject(e.target.value)} placeholder="e.g. Applied Chemistry" />
                                    </div>
                                    <div className="form-group">
                                        <label>Day</label>
                                        <select value={classDay} onChange={(e) => setClassDay(e.target.value)}>
                                            {WEEK_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Time Slot</label>
                                        <input value={classSlot} onChange={(e) => setClassSlot(e.target.value)} placeholder="09:00 - 10:00" />
                                    </div>
                                    <div className="form-group">
                                        <label>Location</label>
                                        <input value={classLocation} onChange={(e) => setClassLocation(e.target.value)} placeholder="Room 101" />
                                    </div>
                                    <button
                                        className="auth-submit"
                                        onClick={() => createSchedule.mutate()}
                                        disabled={!classTitle.trim() || !classSlot.trim() || createSchedule.isPending}
                                    >
                                        {createSchedule.isPending ? 'Saving...' : 'Add Schedule Slot'}
                                    </button>
                                </section>
                            </div>
                        )}

                        {/* ── Weekly Timetable ── */}
                        <section className="tech-highlight" style={{ marginBottom: '1.2rem' }}>
                            <h2 style={{ marginTop: 0 }}>Weekly Timetable</h2>
                            {scheduleQuery.isLoading ? <p>Loading...</p> : schedule.length === 0 ? (
                                <p style={{ color: '#888' }}>No timetable entries yet{canEdit ? '. Add schedule slots above.' : '.'}</p>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.8rem' }}>
                                    {WEEK_DAYS.map((day) => {
                                        const slots = scheduleByDay[day];
                                        if (!slots || slots.length === 0) return null;
                                        return (
                                            <div key={day}>
                                                <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>{day}</div>
                                                {slots.map((slot) => (
                                                    <div key={slot.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #222' }}>
                                                        <div>
                                                            <div style={{ fontWeight: 700 }}>{slot.title}</div>
                                                            <div style={{ color: '#888', fontSize: '0.85rem' }}>
                                                                {slot.slot} • {slot.location || 'TBD'}
                                                                {slot.subject ? ` • ${slot.subject}` : ''}
                                                            </div>
                                                            {slot.teacher_name && (
                                                                <div style={{ color: '#666', fontSize: '0.78rem' }}>Set by {slot.teacher_name}</div>
                                                            )}
                                                        </div>
                                                        {canEdit && (
                                                            <button className="module-btn ghost" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => removeSchedule.mutate(slot.id)}>
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        {/* ── Assignments List ── */}
                        <section className="tech-highlight" style={{ marginBottom: '1.2rem' }}>
                            <h2 style={{ marginTop: 0 }}>Assignments</h2>
                            {assignmentsQuery.isLoading ? <p>Loading...</p> : assignments.length === 0 ? (
                                <p style={{ color: '#888' }}>No assignments yet{canEdit ? '. Add assignments above.' : '.'}</p>
                            ) : assignments.map((item) => (
                                <div key={item.id} style={{ borderBottom: '1px solid #222', padding: '0.6rem 0' }}>
                                    <div style={{ fontWeight: 700 }}>{item.title}</div>
                                    {item.subject && <div style={{ color: '#888', fontSize: '0.85rem' }}>{item.subject}</div>}
                                    {item.description && <div style={{ color: '#888', fontSize: '0.85rem' }}>{item.description}</div>}
                                    <div style={{ color: '#888', fontSize: '0.8rem' }}>
                                        Due: {item.due_date}
                                        {item.teacher_name ? ` • Assigned by ${item.teacher_name}` : ''}
                                    </div>
                                </div>
                            ))}
                        </section>

                        {/* ── Deadline Calendar ── */}
                        <section className="tech-highlight">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                <h2 style={{ margin: 0 }}>Deadline Calendar</h2>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button className="module-btn ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
                                        ← Prev
                                    </button>
                                    <button className="module-btn ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
                                        Next →
                                    </button>
                                </div>
                            </div>
                            <p style={{ color: '#888', marginTop: 0, fontSize: '0.9rem' }}>
                                {calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '0.35rem' }}>
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                                    <div key={d} style={{ color: '#888', fontSize: '0.72rem', textTransform: 'uppercase', textAlign: 'center', padding: '0.3rem 0' }}>{d}</div>
                                ))}
                                {calendarDays.map((cell, idx) => (
                                    <div
                                        key={`${cell?.iso || 'empty'}-${idx}`}
                                        style={{
                                            minHeight: '56px',
                                            border: '1px solid #222',
                                            padding: '0.35rem',
                                            background: cell?.count ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                                        }}
                                    >
                                        {cell ? (
                                            <>
                                                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{cell.day}</div>
                                                {cell.count > 0 ? (
                                                    <div style={{ fontSize: '0.68rem', marginTop: '0.2rem', color: '#fff' }}>
                                                        {cell.count} due
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
}
