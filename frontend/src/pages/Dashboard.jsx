import { useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { useTeacherAccess } from '../hooks/useTeacherAccess';
import { Link, useNavigate } from 'react-router-dom';
import { notificationsApi, profileApi, resourceApi } from '../lib/localBase';
import { GoDownload } from 'react-icons/go';


import SpotlightCard from '../components/SpotlightCard';
import PdfViewer from '../components/PdfViewer';
import './Page.css';

function FeatureCard({ title, desc, to, spotlightColor }) {
    return (
        <Link to={to} className="feature-card-link">
            <SpotlightCard className="feature-card" spotlightColor={spotlightColor}>
                <p className="feature-card-kicker">Module</p>
                <h3>{title}</h3>
                <p>{desc}</p>
                <span className="feature-card-cta">Open module</span>
            </SpotlightCard>
        </Link>
    );
}

export default function Dashboard() {
    const { user, profile, loading, isTeacher, isAdmin } = useAuth();
    const navigate = useNavigate();
    const displayName = profile?.username || user?.username || (profile?.email || user?.email || 'User').split('@')[0];

    const [notifications, setNotifications] = useState([]);
    const [newTitle, setNewTitle] = useState('');
    const [newFile, setNewFile] = useState(null);
    const [posting, setPosting] = useState(false);
    const [viewingResource, setViewingResource] = useState(null);

    // Disable Lenis when PDF viewer is open
    useEffect(() => {
        if (viewingResource) {
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
    const [editMode, setEditMode] = useState(false);
    const [aboutMe, setAboutMe] = useState(profile?.about_me || '');
    const [profileMessage, setProfileMessage] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const { teacherAccess, teacherAccessLoading, teacherAccessError } = useTeacherAccess(user, isTeacher);

    const handleProfileSave = async () => {
        if (!user || !profile) return;
        if (profile.role !== 'student') return;
        setSavingProfile(true);
        setProfileMessage('');
        try {
            const payload = { about_me: aboutMe };

            await profileApi.updateMeta(user.id, payload);
            setProfileMessage('Profile updated successfully. Refreshing...');
            setEditMode(false);
            window.location.reload();
        } catch (err) {
            setProfileMessage(err?.message || 'Failed to update profile');
        } finally {
            setSavingProfile(false);
        }
    };

    useEffect(() => {
        if (!loading && !user) {
            navigate('/login');
        } else if (user) {
            notificationsApi.list().then(setNotifications).catch(console.error);
        }
    }, [user, loading, navigate]);


    useEffect(() => {
        setAboutMe(profile?.about_me || '');
        setProfileMessage('');
        setEditMode(false);
    }, [profile?.id, profile?.about_me]);

    const teacherAllowedClasses = teacherAccess?.allowed_classes || [];
    const teacherHomeClasses = teacherAccess?.home_classes || [];
    const teacherSubjectAccess = teacherAccess?.subject_access || [];
    const accessPreview = teacherAllowedClasses.slice(0, 3);

    const handleCreateNotification = async (e) => {
        e.preventDefault();
        if (!newTitle) return;
        setPosting(true);
        try {
            let fileUrl = null;
            if (newFile) {
                if (newFile.size <= 0 || newFile.size > 12 * 1024 * 1024) throw new Error("File must be under 12MB");
                fileUrl = await resourceApi.uploadPdf(newFile);
            }

        await notificationsApi.create(newTitle, '', fileUrl);
            setNewTitle('');
            setNewFile(null);
            const msgs = await notificationsApi.list();
            setNotifications(msgs);
        } catch (err) {
            alert('Error creating circular: ' + err.message);
        } finally {
            setPosting(false);
        }
    };

    const handleDownload = async (resource) => {
        const url = resource.file_url;
        if (!url) return;
        const safeName = `${(resource.title || 'resource').replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
        try {
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
        } catch {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    if (loading) return <div className="page-container dashboard-page dashboard-loading-wrap">
        <div className="dashboard-loading">
            <h2>Loading your Nexu workspace...</h2>
            <p>Preparing your modules.</p>
        </div>
    </div>;

    if (!user) return null;

    return (
        <div className="page-container dashboard-page">
            <PdfViewer 
                resource={viewingResource} 
                onDownload={handleDownload} 
                onClose={() => setViewingResource(null)} 
            />
            <div className="page-content dashboard-content">
                <section className="dashboard-hero">
                    <div className="dashboard-hero-main">
                        <p className="dashboard-kicker">Nexu Workspace</p>
                        <h1 className="dashboard-title">Dashboard</h1>
                        <h2 className="dashboard-name">{displayName}</h2>
                        <p className="dashboard-email">{profile?.email || user.email}</p>

                    </div>

                    <div className="dashboard-hero-side">
                        <div className="dashboard-meta-block">
                            <p>Role</p>
                            <strong>{profile?.role}</strong>
                        </div>
                        {profile?.role === 'student' && (
                            <div className="dashboard-meta-block">
                                <p>Branch</p>
                                <strong>{profile?.field_of_study}</strong>
                            </div>
                        )}
                        {profile?.role === 'student' && (
                            <div className="dashboard-meta-block">
                                <p>Semester / Section</p>
                                <strong>{profile?.semester} / {profile?.section}</strong>
                            </div>
                        )}
                        <div className="dashboard-meta-block">
                            <p>Status</p>
                            <strong>Active</strong>
                        </div>
                        {isTeacher && (
                            <div className="dashboard-meta-block dashboard-access-block">
                                <p>Access Summary</p>
                                <strong>{teacherAllowedClasses.length} Assigned Classes</strong>

                                {teacherAccessLoading && (
                                    <div className="dashboard-access-note">Loading access rules...</div>
                                )}
                                {!teacherAccessLoading && teacherAccessError && (
                                    <div className="dashboard-access-note error">{teacherAccessError}</div>
                                )}
                                {!teacherAccessLoading && !teacherAccessError && (
                                    <>
                                        <div className="dashboard-access-pills">
                                            <span>{teacherHomeClasses.length} Home</span>
                                            <span>{teacherSubjectAccess.length} Subject Mappings</span>
                                        </div>
                                        {accessPreview.length > 0 ? (
                                            <div className="dashboard-access-list">
                                                {accessPreview.map((item, idx) => (
                                                    <div key={`${item.field_of_study}-${item.semester}-${item.section}-${idx}`}>
                                                        {item.field_of_study} | Sem {item.semester} | Sec {item.section}
                                                    </div>
                                                ))}
                                                {teacherAllowedClasses.length > accessPreview.length && (
                                                    <div className="dashboard-access-more">+{teacherAllowedClasses.length - accessPreview.length} more</div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="dashboard-access-note">No class access assigned yet. Ask admin to assign your classes.</div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                <section className="dashboard-modules-head">
                    <p className="dashboard-kicker">Core Modules</p>
                    <h2>Everything you need, one click away.</h2>
                </section>

                <div className="dashboard-modules-grid">
                    {!isAdmin && (
                        <FeatureCard
                            title="Real-Time Attendance"
                            desc={isTeacher ? 'Mark subject-wise attendance and track student status.' : 'Track your attendance percentage subject-wise.'}
                            to="/attendance"
                            spotlightColor="rgba(255, 170, 0, 0.23)"
                        />
                    )}
                    {!isAdmin && (
                        <FeatureCard
                            title={isTeacher ? "Teacher's Portal" : "Exams & Resources"}
                            desc={isTeacher ? 'Upload notes/assignments for each branch.' : 'Access branch-wise notes, assignments, and exam resources.'}
                            to={isTeacher ? '/teacher/upload' : '/resources'}
                            spotlightColor="rgba(0, 229, 255, 0.22)"
                        />
                    )}

                    {isTeacher && (
                        <FeatureCard
                            title="RFID Portal"
                            desc="Check your attendance and export your own attendance data."
                            to="/teacher-attendance"
                            spotlightColor="rgba(180, 50, 255, 0.22)"
                        />
                    )}
                    {isAdmin && (
                        <FeatureCard
                            title="Admin Portal"
                            desc="Manage all students and faculty, including overriding hardware RFID linkages."
                            to="/admin"
                            spotlightColor="rgba(255, 50, 50, 0.22)"
                        />
                    )}
                    <FeatureCard
                        title="Timetable & Assignments"
                        desc={canEdit ? 'Set class timetables, create assignments, and manage the deadline calendar.' : 'View your class timetable, assignments, and deadline calendar.'}
                        to="/timetable"
                        spotlightColor="rgba(130, 255, 50, 0.22)"
                    />
                </div>

                {profile?.role === 'student' && (
                    <>
                        <section className="dashboard-modules-head" style={{ marginTop: '3rem' }}>
                            <p className="dashboard-kicker">Profile</p>
                            <h2>About Me</h2>
                        </section>

                        <div style={{
                            marginTop: '1.2rem',
                            background: '#000',
                            border: '1px solid #333',
                            padding: '1.2rem'
                        }}>
                            {!editMode && (
                                <>
                                    <p style={{ margin: 0, marginBottom: '0.8rem', color: 'rgba(255,255,255,0.86)', lineHeight: '1.6' }}>
                                        {profile?.about_me || 'No About Me added yet.'}
                                    </p>
                                    <button type="button" className="module-btn" onClick={() => setEditMode(true)}>
                                        Edit About Me
                                    </button>
                                </>
                            )}

                            {editMode && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                    <label style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>About Me</label>
                                    <textarea
                                        value={aboutMe}
                                        onChange={(e) => setAboutMe(e.target.value)}
                                        rows={4}
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: '0', border: '1px solid #333', background: '#000', color: '#fff' }}
                                        placeholder="Write a short profile bio"
                                    />

                                    {profileMessage && (
                                        <div className={profileMessage.toLowerCase().includes('failed') ? 'module-message error' : 'module-message success'}>
                                            {profileMessage}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        <button type="button" className="module-btn" onClick={handleProfileSave} disabled={savingProfile}>
                                            {savingProfile ? 'Saving...' : 'Save Profile'}
                                        </button>
                                        <button type="button" className="module-btn ghost" onClick={() => setEditMode(false)} disabled={savingProfile}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}

                <section className="dashboard-modules-head" style={{ marginTop: '4rem' }}>
                    <p className="dashboard-kicker">Important</p>
                    <h2>Recent Notifications & Circulars</h2>
                </section>
                
                <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {isAdmin && (
                        <form onSubmit={handleCreateNotification} style={{ background: '#000', padding: '1.5rem', border: '1px solid #333', marginBottom: '1rem' }}>
                            <h3 style={{ marginBottom: '1rem', color: '#fff', fontSize: '1.1rem' }}>Release Circular</h3>
                            <input 
                                type="text"
                                placeholder="Circular Title..."
                                value={newTitle}
                                onChange={e => setNewTitle(e.target.value)}
                                style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem', background: '#000', border: '1px solid #333', color: '#fff', borderRadius: '0' }}
                            />
                    
                            <input
                                type="file"
                                accept=".pdf"
                                onChange={(e) => setNewFile(e.target.files[0])}
                                style={{ width: '100%', marginBottom: '1rem', color: '#fff' }}
                            />
                            <button type="submit" className="auth-submit" style={{ width: 'max-content', padding: '0.5rem 1.5rem' }} disabled={posting}>
                                {posting ? 'Posting...' : 'Publish Notification'}
                            </button>
                        </form>
                    )}

                    {notifications.length === 0 && (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#888', background: '#000', border: '1px solid #333' }}>
                            No recent notifications or circulars.
                        </div>
                    )}
                    {notifications.map(note => (
                        <div key={note.id} style={{
                            background: '#000',
                            padding: '1.5rem',
                            border: '1px solid #333',
                            borderLeft: '3px solid #fff'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <h3 style={{ color: '#fff', fontSize: '1.1rem' }}>{note.title}</h3>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>{new Date(note.created_at).toLocaleDateString()}</span>
                            </div>
                            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{note.body}</p>
                            
                            {note.file_url && (
                                <div style={{ marginTop: '1rem' }}>
                                    <button 
                                        className="module-btn" 
                                        style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
                                        onClick={() => setViewingResource(note)}
                                    >
                                        View Attached PDF
                                    </button>
                                </div>
                            )}

                            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--color-gray)' }}>
                                Released by {note.author_name}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
