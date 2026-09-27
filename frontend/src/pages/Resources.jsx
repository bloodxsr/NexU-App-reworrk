import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { Navigate } from 'react-router-dom';
import { GoDownload } from 'react-icons/go';
import { useQuery } from '@tanstack/react-query';
import './Page.css';
import { resourceApi } from '../lib/localBase';

const toLocalDateKey = (dateLike = new Date()) => {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const isPdfResource = (resource) => {
    const url = String(resource?.file_url || '').toLowerCase();
    return url.startsWith('data:application/pdf') || url.endsWith('.pdf');
};

export default function Resources() {
    const { user, profile, loading: authLoading, profileError } = useAuth();
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [hoveredDate, setHoveredDate] = useState('');
    const [viewingResource, setViewingResource] = useState(null);

    // Disable Lenis when PDF viewer is open
    useEffect(() => {
        if (viewingResource) {
            // Try to find Lenis instance and disable it
            if (window.lenis) {
                window.lenis.stop();
            }
            document.body.style.overflow = 'hidden';
        } else {
            if (window.lenis) {
                window.lenis.start();
            }
            document.body.style.overflow = '';
        }
    }, [viewingResource]);

    const [searchInput, setSearchInput] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // Only update searchTerm when Enter is pressed
    const handleSearchInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            setSearchTerm(searchInput.trim());
        }
    };

    const resourcesQuery = useQuery({
        queryKey: ['resources', profile?.field_of_study, profile?.semester, profile?.section, searchTerm],
        enabled: !!user && !!profile?.field_of_study,
        queryFn: async () => {
            return await resourceApi.listByAudience(
                profile.field_of_study,
                profile?.semester,
                profile?.section,
                searchTerm,
            );
        },
    });

    const resourcesData = resourcesQuery.data;
    const resources = resourcesData ?? [];
    const resourcesError = resourcesQuery.error?.message || '';
    // Group by subject for notes and assignments
    const groupBySubject = (arr) => {
        const map = {};
        arr.forEach((item) => {
            const subj = item.subject || 'Other';
            if (!map[subj]) map[subj] = [];
            map[subj].push(item);
        });
        return map;
    };
    const notesBySubject = groupBySubject(resources.filter((res) => res.type === 'note'));
    const assignmentsBySubject = groupBySubject(resources.filter((res) => res.type === 'assignment'));
    const deadlineMap = useMemo(() => {
        const map = new Map();
        (resourcesData || []).forEach((item) => {
            if (item.type !== 'assignment' || !item.deadline) return;
            map.set(item.deadline, (map.get(item.deadline) || 0) + 1);
        });
        return map;
    }, [resourcesData]);

    const deadlineResourcesMap = useMemo(() => {
        const map = new Map();
        (resourcesData || []).forEach((item) => {
            if (item.type !== 'assignment' || !item.deadline) return;
            if (!map.has(item.deadline)) map.set(item.deadline, []);
            map.get(item.deadline).push(item);
        });
        return map;
    }, [resourcesData]);

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

    const handleDownload = async (resource) => {
        const url = resource.file_url;
        if (!url) return;
        const safeName = `${(resource.title || 'resource').replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
        try {
            if (url.startsWith('data:')) {
                const res = await fetch(url);
                const blob = await res.blob();
                const objectUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = safeName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(objectUrl);
                return;
            }
            const link = document.createElement('a');
            link.href = url;
            link.download = safeName;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    if (authLoading) return <div className="page-container module-page"><div className="page-content module-content">Loading...</div></div>;
    if (!user) return <Navigate to="/login" />;
    if (profileError) return <div className="page-container module-page"><div className="page-content module-content">{profileError}</div></div>;
    if (!profile) return <div className="page-container module-page"><div className="page-content module-content">Loading profile...</div></div>;
    if (profile.role === 'teacher') return <Navigate to="/teacher/upload" />;
    if (resourcesQuery.isLoading) return <div className="page-container module-page"><div className="page-content module-content">Loading...</div></div>;

    return (
        <div className="page-container module-page">
            {viewingResource && (
                <div className="pdf-viewer-overlay" style={{
                    position: 'fixed', inset: 0, zIndex: 9999, background: '#000000', display: 'flex', flexDirection: 'column'
                }}>
                    <div className="pdf-viewer-header" style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid #333', background: '#000'
                    }}>
                        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{viewingResource.title}</h2>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="module-btn" onClick={() => handleDownload(viewingResource)}>
                                <GoDownload /> Download File
                            </button>
                            <button className="module-btn ghost" onClick={() => setViewingResource(null)}>
                                Close Viewer
                            </button>
                        </div>
                    </div>
                    <div className="pdf-viewer-body" style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
                        <iframe
                            src={viewingResource.file_url}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            title={viewingResource.title}
                            data-lenis-prevent
                        />
                    </div>
                </div>
            )}
            <div className="page-content module-content">
                <div className="module-header">
                    <p className="module-kicker">Resources</p>
                    <h1>Resource Feed</h1>
                </div>
                {resourcesQuery.isFetching && !resourcesQuery.isLoading && (
                    <p className="module-refreshing">Refreshing...</p>
                )}
                <p className="module-subtext">
                    Materials for {profile.field_of_study} | Semester {profile.semester} | Section {profile.section}.
                </p>
                <div className="form-group module-filter">
                    <label>Search resources</label>
                    <input
                        type="search"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleSearchInputKeyDown}
                        placeholder="Type and press Enter to search by title, subject, or type..."
                    />
                </div>
                {resourcesError && (
                    <div className="module-message error">{resourcesError}</div>
                )}
                <div className="resources-list module-stack">
                    {resources.length === 0 ? <p>No resources available yet.</p> : null}
                    {/* Notes by Subject */}
                    <section>
                        <h2 className="module-section-title">Notes</h2>
                        {Object.keys(notesBySubject).length === 0 ? (
                            <p className="module-muted">No notes uploaded yet.</p>
                        ) : (
                            Object.entries(notesBySubject).map(([subject, notes]) => (
                                <div key={subject}>
                                    <h3 style={{marginTop: '1.5rem', marginBottom: '0.5rem'}}>{subject}</h3>
                                    {notes.map((res) => (
                                        <div key={res.id} className="module-item-card" style={{cursor: isPdfResource(res) ? 'pointer' : 'default'}}
                                            onClick={() => isPdfResource(res) ? setViewingResource(res) : undefined}
                                        >
                                            <div>
                                                <div className="module-chip note">Note</div>
                                                <h3>{res.title}</h3>
                                                <p className="module-muted-sm">Uploaded: {new Date(res.created_at).toLocaleDateString()}</p>
                                            </div>
                                            {isPdfResource(res) ? (
                                                <button className="module-btn" onClick={e => {e.stopPropagation(); setViewingResource(res);}}>
                                                    View PDF
                                                </button>
                                            ) : (
                                                <button className="module-btn" onClick={e => {e.stopPropagation(); handleDownload(res);}}>
                                                    <GoDownload /> Download
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ))
                        )}
                    </section>
                    {/* Assignments by Subject */}
                    <section>
                        <h2 className="module-section-title">Assignments</h2>
                        {Object.keys(assignmentsBySubject).length > 0 && (
                            <div className="module-panel module-calendar-wrap">
                                <div className="module-calendar-head">
                                    <h3>Deadline Calendar</h3>
                                    <div className="module-calendar-nav">
                                        <button className="module-btn ghost" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>Prev</button>
                                        <button className="module-btn ghost" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>Next</button>
                                    </div>
                                </div>
                                <p className="module-muted">{calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</p>
                                <div className="module-calendar-grid">
                                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                                        <div key={d} className="module-calendar-day">{d}</div>
                                    ))}
                                    {calendarDays.map((cell, idx) => (
                                        <div
                                            key={`${cell?.iso || 'empty'}-${idx}`}
                                            className={`module-calendar-cell ${cell?.count ? 'has-deadline' : ''}`}
                                            onMouseEnter={() => {
                                                if (cell?.count) setHoveredDate(cell.iso);
                                            }}
                                            onMouseLeave={() => setHoveredDate('')}
                                        >
                                            {cell ? (
                                                <>
                                                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{cell.day}</div>
                                                    {cell.count > 0 ? (
                                                        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                                            {cell.count} deadline{cell.count > 1 ? 's' : ''}
                                                        </div>
                                                    ) : null}
                                                    {hoveredDate === cell.iso && (
                                                        <div className="module-calendar-tooltip">
                                                            <div className="module-tooltip-title">Due on {cell.iso}</div>
                                                            {(deadlineResourcesMap.get(cell.iso) || []).map((resItem) => {
                                                                const isPdf = isPdfResource(resItem);
                                                                return (
                                                                    <button
                                                                        key={resItem.id}
                                                                        className="module-btn ghost block"
                                                                        onClick={() => isPdf ? setViewingResource(resItem) : handleDownload(resItem)}
                                                                    >
                                                                        {isPdf ? `View: ${resItem.title}` : `Download: ${resItem.title}`}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {Object.keys(assignmentsBySubject).length === 0 ? (
                            <p className="module-muted">No assignments uploaded yet.</p>
                        ) : (
                            Object.entries(assignmentsBySubject).map(([subject, assignments]) => (
                                <div key={subject}>
                                    <h3 style={{marginTop: '1.5rem', marginBottom: '0.5rem'}}>{subject}</h3>
                                    {assignments.map((res) => {
                                        const today = toLocalDateKey(new Date());
                                        const isOverdue = !!res.deadline && res.deadline < today;
                                        return (
                                            <div key={res.id} className="module-item-card" style={{cursor: isPdfResource(res) ? 'pointer' : 'default'}}
                                                onClick={() => isPdfResource(res) ? setViewingResource(res) : undefined}
                                            >
                                                <div>
                                                    <div className="module-chip assignment">Assignment</div>
                                                    <h3>{res.title}</h3>
                                                    <p className="module-muted-sm">Deadline: {res.deadline || 'Not set'} {isOverdue ? '| Overdue' : ''}</p>
                                                </div>
                                                {isPdfResource(res) ? (
                                                    <button className="module-btn" onClick={e => {e.stopPropagation(); setViewingResource(res);}}>
                                                        View PDF
                                                    </button>
                                                ) : (
                                                    <button className="module-btn" onClick={e => {e.stopPropagation(); handleDownload(res);}}>
                                                        <GoDownload /> Download
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

