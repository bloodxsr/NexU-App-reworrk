import { useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { Navigate } from 'react-router-dom';
import { profileApi } from '../lib/localBase';
import './Page.css';
import './AdminDashboard.css';

const BRANCH_OPTIONS = ['AIML', 'IIOT', 'CSE', 'CYBER', 'AIDS', 'CSAM'];
const SEMESTER_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const SECTION_OPTIONS = ['A', 'B', 'C'];
const SUBJECT_OPTIONS = [
    'Electrical Science', 'Applied Mathematics I', 'Engineering Graphics', 'Manufacturing Processes',
    'Communication Skills', 'Applied Physics I', 'Indian Constitution', 'Engineering Mechanics',
    'Programming in C', 'Workshop Practice', 'Environmental Science', 'Applied Chemistry',
    'Human Values and Professional Ethics', 'Applied Physics II', 'Applied Mathematics II',
    'Probability, Statistics and Linear Algebra', 'Data Structures', 'Critical Reasoning and System Thinking',
    'Digital Logic Design', 'Universal Human Values', 'Principles of Artificial Intelligence'
];

const defaultAccessForm = () => ({
    field_of_study: BRANCH_OPTIONS[0],
    semester: SEMESTER_OPTIONS[0],
    section: SECTION_OPTIONS[0],
    subject: SUBJECT_OPTIONS[0],
    home_field_of_study: BRANCH_OPTIONS[0],
    home_semester: SEMESTER_OPTIONS[0],
    home_section: SECTION_OPTIONS[0],
});

const emptyTeacherAccess = (teacherId) => ({
    teacher_id: teacherId,
    subject_access: [],
    home_classes: [],
    allowed_classes: [],
});

const accessClassLabel = (item) => `${item.field_of_study} | Sem ${item.semester} | Sec ${item.section}`;

export default function AdminDashboard() {
    const { user, isAdmin, loading: authLoading } = useAuth();
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [rfidInputs, setRfidInputs] = useState({});
    const [linking, setLinking] = useState({});
    const [teacherAccess, setTeacherAccess] = useState({});
    const [accessForms, setAccessForms] = useState({});
    const [accessSaving, setAccessSaving] = useState({});
    const [accessErrors, setAccessErrors] = useState({});
    const [expandedAccessRows, setExpandedAccessRows] = useState({});
    const [whitelistUploading, setWhitelistUploading] = useState({ students: false, teachers: false });
    const [whitelistStatus, setWhitelistStatus] = useState({ students: '', teachers: '' });
    const [filterBranch, setFilterBranch] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [tempSearch, setTempSearch] = useState('');
    const [facultySearch, setFacultySearch] = useState('');
    const [tempFacultySearch, setTempFacultySearch] = useState('');

    const loadTeacherAccess = async (teacherId) => {
        try {
            const data = await profileApi.getTeacherAccessForAdmin(teacherId);
            setTeacherAccess(prev => ({ ...prev, [teacherId]: data }));
            setAccessErrors(prev => ({ ...prev, [teacherId]: '' }));
        } catch (err) {
            setTeacherAccess(prev => ({ ...prev, [teacherId]: emptyTeacherAccess(teacherId) }));
            setAccessErrors(prev => ({ ...prev, [teacherId]: err.message || 'Failed to load teacher access' }));
        }
    };

    const fetchProfiles = async () => {
        try {
            const data = await profileApi.listAll();
            setProfiles(data);

            const teacherRows = data.filter(p => p.role === 'teacher');
            setAccessForms(prev => {
                const next = { ...prev };
                for (const teacher of teacherRows) {
                    if (!next[teacher.id]) {
                        next[teacher.id] = defaultAccessForm();
                    }
                }
                return next;
            });

            const accessEntries = await Promise.all(
                teacherRows.map(async (teacher) => {
                    try {
                        const access = await profileApi.getTeacherAccessForAdmin(teacher.id);
                        return [teacher.id, access, ''];
                    } catch (err) {
                        return [teacher.id, emptyTeacherAccess(teacher.id), err.message || 'Failed to load teacher access'];
                    }
                })
            );

            const accessMap = {};
            const errorMap = {};
            for (const [teacherId, access, accessErr] of accessEntries) {
                accessMap[teacherId] = access;
                errorMap[teacherId] = accessErr;
            }
            setTeacherAccess(accessMap);
            setAccessErrors(errorMap);
        } catch (err) {
            setError(err.message || 'Failed to fetch profiles');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading && isAdmin) {
            fetchProfiles();
        }
    }, [authLoading, isAdmin]);

    if (authLoading || loading) return <div className="page-container admin-portal-page"><div className="page-content">Loading...</div></div>;
    if (!user) return <Navigate to="/login" />;
    if (!isAdmin) return <Navigate to="/dashboard" />;

    const filteredStudents = profiles
        .filter(p => p.role === 'student')
        .filter(s => filterBranch === 'All' || s.field_of_study === filterBranch)
        .filter(s => {
            const search = searchTerm.toLowerCase();
            return !search || 
                   (s.username || '').toLowerCase().includes(search) || 
                   (s.email || '').toLowerCase().includes(search) ||
                   (s.id || '').toLowerCase().includes(search);
        });

    const getAccessForm = (teacherId) => accessForms[teacherId] || defaultAccessForm();

    const handleAccessFieldChange = (teacherId, field, value) => {
        setAccessForms(prev => ({
            ...prev,
            [teacherId]: {
                ...getAccessForm(teacherId),
                [field]: value,
            },
        }));
    };

    const withAccessSaving = async (teacherId, action) => {
        setAccessSaving(prev => ({ ...prev, [teacherId]: true }));
        setAccessErrors(prev => ({ ...prev, [teacherId]: '' }));
        try {
            await action();
            await loadTeacherAccess(teacherId);
        } catch (err) {
            setAccessErrors(prev => ({ ...prev, [teacherId]: err.message || 'Failed to update teacher access' }));
        } finally {
            setAccessSaving(prev => ({ ...prev, [teacherId]: false }));
        }
    };

    const handleAddSubjectAccess = async (teacherId) => {
        const form = getAccessForm(teacherId);
        await withAccessSaving(teacherId, async () => {
            await profileApi.addTeacherSubjectAccess(teacherId, {
                field_of_study: form.field_of_study,
                semester: form.semester,
                section: form.section,
                subject: form.subject,
            });
        });
    };

    const handleRemoveSubjectAccess = async (teacherId, item) => {
        await withAccessSaving(teacherId, async () => {
            await profileApi.removeTeacherSubjectAccess(teacherId, {
                field_of_study: item.field_of_study,
                semester: item.semester,
                section: item.section,
                subject: item.subject,
            });
        });
    };

    const handleAssignHomeClass = async (teacherId) => {
        const form = getAccessForm(teacherId);
        await withAccessSaving(teacherId, async () => {
            await profileApi.assignHomeClass(teacherId, {
                field_of_study: form.home_field_of_study,
                semester: form.home_semester,
                section: form.home_section,
            });
        });
    };

    const handleRemoveHomeClass = async (teacherId, item) => {
        await withAccessSaving(teacherId, async () => {
            await profileApi.removeHomeClass(teacherId, {
                field_of_study: item.field_of_study,
                semester: item.semester,
                section: item.section,
            });
        });
    };

    const handleRfidChange = (id, value) => {
        setRfidInputs(prev => ({ ...prev, [id]: value }));
    };

    const toggleAccessRow = (teacherId) => {
        setExpandedAccessRows(prev => ({
            ...prev,
            [teacherId]: !prev[teacherId],
        }));
    };

    const handleLinkRfid = async (teacherId) => {
        const uid = rfidInputs[teacherId];
        if (!uid) return;
        
        setLinking(prev => ({ ...prev, [teacherId]: true }));
        try {
            await profileApi.linkRfid(teacherId, uid);
            // Update local state without refetching everything
            setProfiles(prev => prev.map(p => p.id === teacherId ? { ...p, rfid_uid: uid } : p));
            setRfidInputs(prev => ({ ...prev, [teacherId]: '' }));
        } catch (err) {
            alert(`Failed to link RFID: ${err.message}`);
        } finally {
            setLinking(prev => ({ ...prev, [teacherId]: false }));
        }
    };

    const handleWhitelistUpload = async (type, file) => {
        if (!file) return;
        
        setWhitelistUploading(prev => ({ ...prev, [type]: true }));
        setWhitelistStatus(prev => ({ ...prev, [type]: 'Uploading...' }));
        
        try {
            const text = await file.text();
            if (type === 'students') {
                await profileApi.uploadStudentWhitelist(text);
            } else {
                await profileApi.uploadTeacherWhitelist(text);
            }
            setWhitelistStatus(prev => ({ ...prev, [type]: `Successfully uploaded ${file.name}` }));
        } catch (err) {
            setWhitelistStatus(prev => ({ ...prev, [type]: `Error: ${err.message}` }));
        } finally {
            setWhitelistUploading(prev => ({ ...prev, [type]: false }));
        }
    };

    const teachers = profiles.filter(p => p.role === 'teacher' && (facultySearch ? (p.username?.toLowerCase().includes(facultySearch.toLowerCase()) || p.email.toLowerCase().includes(facultySearch.toLowerCase())) : true));
    const students = profiles.filter(p => p.role === 'student' && (filterBranch === 'All' ? true : p.field_of_study === filterBranch) && (searchTerm ? (p.username?.toLowerCase().includes(searchTerm.toLowerCase()) || p.email.toLowerCase().includes(searchTerm.toLowerCase())) : true));

    return (
        <div className="page-container admin-portal-page">
            <div className="page-content">
                <div className="admin-header">
                    <p className="module-kicker">Administrator Portal</p>
                    <h1>Directory Management</h1>
                    <p className="module-subtext" style={{ marginTop: '0.5rem' }}>
                        View registered users and manage hardware integrations.
                    </p>
                    {error && <div className="auth-error" style={{ marginTop: '1rem' }}>{error}</div>}
                </div>

                <div className="admin-tables-container">
                    
                    <section className="admin-table-section whitelist-section">
                        <h2>Authorized Whitelists</h2>
                        <p className="section-desc">Upload CSV master lists to authorize students and teachers for enrollment.</p>
                        <div className="whitelist-grid">
                            <div className="whitelist-card">
                                <h3>Student Whitelist</h3>
                                <p>CSV Format: <code>email,field,semester,section</code></p>
                                <div className="upload-controls">
                                    <input 
                                        type="file" 
                                        accept=".csv" 
                                        id="student-whitelist-upload" 
                                        style={{ display: 'none' }} 
                                        onChange={(e) => handleWhitelistUpload('students', e.target.files[0])}
                                    />
                                    <label htmlFor="student-whitelist-upload" className="admin-btn primary">
                                        {whitelistUploading.students ? 'Uploading...' : 'Upload Student CSV'}
                                    </label>
                                    {whitelistStatus.students && <p className="upload-status">{whitelistStatus.students}</p>}
                                </div>
                            </div>

                            <div className="whitelist-card">
                                <h3>Teacher Whitelist</h3>
                                <p>CSV Format: <code>email</code> (one per line)</p>
                                <div className="upload-controls">
                                    <input 
                                        type="file" 
                                        accept=".csv" 
                                        id="teacher-whitelist-upload" 
                                        style={{ display: 'none' }} 
                                        onChange={(e) => handleWhitelistUpload('teachers', e.target.files[0])}
                                    />
                                    <label htmlFor="teacher-whitelist-upload" className="admin-btn primary">
                                        {whitelistUploading.teachers ? 'Uploading...' : 'Upload Teacher CSV'}
                                    </label>
                                    {whitelistStatus.teachers && <p className="upload-status">{whitelistStatus.teachers}</p>}
                                </div>
                            </div>
                        </div>
                    </section>
                    
                    <section className="admin-table-section">
                        <div className="table-header-flex">
                            <h2>Registered Faculty ({teachers.length})</h2>
                            <input 
                                type="text"
                                className="admin-filter-select"
                                style={{ width: '250px' }}
                                placeholder="Search & press Enter..."
                                value={tempFacultySearch}
                                onChange={(e) => setTempFacultySearch(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') setFacultySearch(tempFacultySearch);
                                }}
                            />
                        </div>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Name/ID</th>
                                    <th>Email</th>
                                    <th>Teacher Controls</th>
                                </tr>
                            </thead>
                            <tbody>
                                {teachers.map(teacher => {
                                    const teacherAccessData = teacherAccess[teacher.id] || emptyTeacherAccess(teacher.id);
                                    const form = getAccessForm(teacher.id);
                                    const isAccessBusy = !!accessSaving[teacher.id];
                                    const accessError = accessErrors[teacher.id];
                                    const isAccessExpanded = !!expandedAccessRows[teacher.id];
                                    const subjectCount = teacherAccessData.subject_access?.length || 0;
                                    const homeCount = teacherAccessData.home_classes?.length || 0;
                                    const allowedClassCount = teacherAccessData.allowed_classes?.length || 0;

                                    return (
                                    <tr key={teacher.id}>
                                        <td>{teacher.username || teacher.id.substring(0, 8)}</td>
                                        <td>{teacher.email}</td>
                                        <td className="admin-access-cell">
                                            {accessError && <div className="auth-error" style={{ marginBottom: '0.7rem' }}>{accessError}</div>}

                                            <button
                                                type="button"
                                                className={`admin-access-toggle ${isAccessExpanded ? 'open' : ''}`}
                                                onClick={() => toggleAccessRow(teacher.id)}
                                            >
                                                <span className="admin-access-toggle-head">Manage Access</span>
                                                <span className="admin-access-toggle-meta">
                                                    {allowedClassCount} classes | {subjectCount} subject rules | {homeCount} home classes
                                                </span>
                                                <span className="admin-access-toggle-arrow">▾</span>
                                            </button>

                                            <div className={`admin-access-dropdown ${isAccessExpanded ? 'open' : ''}`} aria-hidden={!isAccessExpanded}>
                                                    <div className="admin-overview-grid">
                                                        <div className="admin-overview-item">
                                                            <span>ID</span>
                                                            <strong>{teacher.id}</strong>
                                                        </div>
                                                        <div className="admin-overview-item">
                                                            <span>RFID UID</span>
                                                            <strong>{teacher.rfid_uid || 'Unlinked'}</strong>
                                                        </div>
                                                        <div className="admin-overview-item">
                                                            <span>Resume</span>
                                                            <strong>
                                                                {teacher.resume_url ? (
                                                                    <a href={teacher.resume_url} target="_blank" rel="noopener noreferrer">Open Resume</a>
                                                                ) : 'Not uploaded'}
                                                            </strong>
                                                        </div>
                                                    </div>

                                                    <div className="admin-access-group" style={{ marginTop: '0.8rem' }}>
                                                        <p className="admin-access-title">RFID Linkage</p>
                                                        <div className="rfid-admin-form">
                                                            <input 
                                                                type="text" 
                                                                placeholder={teacher.rfid_uid ? 'Override UID...' : 'Enter UID...'}
                                                                value={rfidInputs[teacher.id] || ''}
                                                                onChange={e => handleRfidChange(teacher.id, e.target.value)}
                                                            />
                                                            <button 
                                                                onClick={() => handleLinkRfid(teacher.id)}
                                                                disabled={linking[teacher.id] || !rfidInputs[teacher.id]}
                                                            >
                                                                {linking[teacher.id] ? (teacher.rfid_uid ? 'Updating...' : 'Linking...') : (teacher.rfid_uid ? 'Update RFID' : 'Link RFID')}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="admin-access-group">
                                                        <p className="admin-access-title">Subject Access (can mark attendance)</p>
                                                        <div className="admin-access-chip-row">
                                                            {teacherAccessData.subject_access?.length > 0 ? teacherAccessData.subject_access.map((item) => {
                                                                const key = `${item.field_of_study}-${item.semester}-${item.section}-${item.subject}`;
                                                                return (
                                                                    <span key={key} className="admin-access-chip">
                                                                        {accessClassLabel(item)} | {item.subject}
                                                                        <button
                                                                            type="button"
                                                                            className="chip-remove"
                                                                            onClick={() => handleRemoveSubjectAccess(teacher.id, item)}
                                                                            disabled={isAccessBusy}
                                                                        >
                                                                            x
                                                                        </button>
                                                                    </span>
                                                                );
                                                            }) : <span className="admin-access-empty">No subject access yet</span>}
                                                        </div>

                                                        <div className="admin-access-form">
                                                            <select value={form.field_of_study} onChange={(e) => handleAccessFieldChange(teacher.id, 'field_of_study', e.target.value)} disabled={isAccessBusy}>
                                                                {BRANCH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                                            </select>
                                                            <select value={form.semester} onChange={(e) => handleAccessFieldChange(teacher.id, 'semester', e.target.value)} disabled={isAccessBusy}>
                                                                {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>Sem {option}</option>)}
                                                            </select>
                                                            <select value={form.section} onChange={(e) => handleAccessFieldChange(teacher.id, 'section', e.target.value)} disabled={isAccessBusy}>
                                                                {SECTION_OPTIONS.map((option) => <option key={option} value={option}>Sec {option}</option>)}
                                                            </select>
                                                            <select value={form.subject} onChange={(e) => handleAccessFieldChange(teacher.id, 'subject', e.target.value)} disabled={isAccessBusy}>
                                                                {SUBJECT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                                            </select>
                                                            <button type="button" onClick={() => handleAddSubjectAccess(teacher.id)} disabled={isAccessBusy}>
                                                                {isAccessBusy ? 'Saving...' : 'Add Subject Access'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="admin-access-group" style={{ marginTop: '0.9rem' }}>
                                                        <p className="admin-access-title">Home Teacher Classes (can view/export class attendance)</p>
                                                        <div className="admin-access-chip-row">
                                                            {teacherAccessData.home_classes?.length > 0 ? teacherAccessData.home_classes.map((item) => {
                                                                const key = `${item.field_of_study}-${item.semester}-${item.section}`;
                                                                return (
                                                                    <span key={key} className="admin-access-chip home">
                                                                        {accessClassLabel(item)}
                                                                        <button
                                                                            type="button"
                                                                            className="chip-remove"
                                                                            onClick={() => handleRemoveHomeClass(teacher.id, item)}
                                                                            disabled={isAccessBusy}
                                                                        >
                                                                            x
                                                                        </button>
                                                                    </span>
                                                                );
                                                            }) : <span className="admin-access-empty">No home-teacher class yet</span>}
                                                        </div>

                                                        <div className="admin-access-form">
                                                            <select value={form.home_field_of_study} onChange={(e) => handleAccessFieldChange(teacher.id, 'home_field_of_study', e.target.value)} disabled={isAccessBusy}>
                                                                {BRANCH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                                            </select>
                                                            <select value={form.home_semester} onChange={(e) => handleAccessFieldChange(teacher.id, 'home_semester', e.target.value)} disabled={isAccessBusy}>
                                                                {SEMESTER_OPTIONS.map((option) => <option key={option} value={option}>Sem {option}</option>)}
                                                            </select>
                                                            <select value={form.home_section} onChange={(e) => handleAccessFieldChange(teacher.id, 'home_section', e.target.value)} disabled={isAccessBusy}>
                                                                {SECTION_OPTIONS.map((option) => <option key={option} value={option}>Sec {option}</option>)}
                                                            </select>
                                                            <button type="button" onClick={() => handleAssignHomeClass(teacher.id)} disabled={isAccessBusy}>
                                                                {isAccessBusy ? 'Saving...' : 'Assign Home Class'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                                {teachers.length === 0 && (
                                    <tr><td colSpan="3" style={{textAlign: 'center', padding: '2rem'}}>No faculty registered</td></tr>
                                )}
                            </tbody>
                        </table>
                    </section>

                    <section className="admin-table-section">
                        <div className="table-header-flex">
                        <h2>Registered Students ({filteredStudents.length})</h2>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input 
                                type="text"
                                className="admin-filter-select"
                                style={{ width: '250px' }}
                                placeholder="Search & press Enter..."
                                value={tempSearch}
                                onChange={(e) => setTempSearch(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') setSearchTerm(tempSearch);
                                }}
                            />
                            <select 
                                className="admin-filter-select"
                                value={filterBranch}
                                onChange={(e) => setFilterBranch(e.target.value)}
                            >
                                <option value="All">All Branches</option>
                                {BRANCH_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                    </div>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Name/ID</th>
                                    <th>Email</th>
                                    <th>Academic Info</th>
                                    <th>About Me</th>
                                    <th>Attendance %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map(student => (
                                    <tr key={student.id}>
                                        <td>
                                            <div className="hover-target">
                                                {student.username || 'No Username'}
                                                <div className="hover-info">
                                                    <p><strong>ID:</strong> {student.id}</p>
                                                    <p><strong>Branch:</strong> {student.field_of_study || 'N/A'}</p>
                                                    <p><strong>Sem/Sec:</strong> {student.semester || 'N/A'} / {student.section || 'N/A'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{student.email}</td>
                                        <td>{student.field_of_study} - Sem {student.semester} - Sec {student.section}</td>
                                        <td>{student.about_me || 'Not set'}</td>
                                        <td style={{ color: (student.attendance_percentage !== undefined && student.attendance_percentage < 75) ? 'red' : '' }}>
                                            {student.attendance_percentage !== undefined ? `${student.attendance_percentage.toFixed(1)}%` : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                                {students.length === 0 && (
                                    <tr><td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>No students registered</td></tr>
                                )}
                            </tbody>
                        </table>
                    </section>

                </div>
            </div>
        </div>
    );
}
