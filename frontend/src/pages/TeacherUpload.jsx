import { useState, useEffect } from 'react';
import { useAuth } from '../context/useAuth';
import { Navigate } from 'react-router-dom';
import './Page.css';
import { resourceApi, profileApi } from '../lib/localBase';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export default function TeacherUpload() {
    const { user, loading: authLoading, isTeacher } = useAuth();
    const [title, setTitle] = useState('');
    const [type, setType] = useState('note');
    const [deadline, setDeadline] = useState('');
    const [field, setField] = useState('AIML');
    const [semester, setSemester] = useState('1');
    const [section, setSection] = useState('A');
    const [subject, setSubject] = useState('');
    const [allowedSubjects, setAllowedSubjects] = useState([]);
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });


    const [accessData, setAccessData] = useState(null);
    const [allowedFields, setAllowedFields] = useState([]);
    const [allowedSemesters, setAllowedSemesters] = useState([]);
    const [allowedSections, setAllowedSections] = useState([]);

    useEffect(() => {
        async function fetchAccess() {
            if (!user) return;
            try {
                const data = await profileApi.getMyTeacherAccess();
                setAccessData(data);
                
                const subjects = [...new Set((data.subject_access || []).map(a => a.subject))].sort();
                setAllowedSubjects(subjects);
                if (subjects.length > 0) {
                    setSubject(subjects[0]);
                }
            } catch (err) {
                console.error("Failed to fetch teacher access", err);
            }
        }
        fetchAccess();
    }, [user]);

    useEffect(() => {
        if (!accessData || !subject) return;
        
        const filtered = (accessData.subject_access || []).filter(a => a.subject === subject);
        
        const fields = [...new Set(filtered.map(a => a.field_of_study))].sort();
        setAllowedFields(fields);
        if (fields.length > 0 && !fields.includes(field)) setField(fields[0]);

        const sems = [...new Set(filtered.map(a => a.semester))].sort();
        setAllowedSemesters(sems);
        if (sems.length > 0 && !sems.includes(semester)) setSemester(sems[0]);

        const secs = [...new Set(filtered.map(a => a.section))].sort();
        setAllowedSections(secs);
        if (secs.length > 0 && !secs.includes(section)) setSection(secs[0]);
    }, [accessData, subject]);

    if (authLoading) return <div className="page-container module-page"><div className="page-content module-content">Loading...</div></div>;
    if (!user) return <Navigate to="/login" />;
    if (!isTeacher) return <Navigate to="/resources" />;

    const uploadResource = async (fileToUpload, chosenField, publicUrl) => {
        await resourceApi.create({
            title: title || fileToUpload.name,
            file_url: publicUrl,
            type,
            deadline: type === 'assignment' ? deadline : null,
            teacher_id: user.id,
            field_of_study: chosenField,
            semester,
            section,
            subject,
        });
    };

    const handleUpload = async (e) => {
        e.preventDefault();

        if (!file) return setMessage({ text: 'Please select a file', type: 'error' });
        if (!subject) return setMessage({ text: 'Please select a subject', type: 'error' });
        if (allowedSubjects.length > 0 && !allowedSubjects.includes(subject)) {
            return setMessage({ text: 'You do not have permission to upload for this subject.', type: 'error' });
        }
        if (type === 'assignment' && !deadline) {
            return setMessage({ text: 'Please set assignment deadline', type: 'error' });
        }

        setUploading(true);
        setMessage({ text: 'Uploading...', type: 'info' });

        try {
            const allowedTypes = [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            ];

            if (!allowedTypes.includes(file.type)) {
                throw new Error('Only PDF, DOCX, and PPTX formats are allowed');
            }
            if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
                throw new Error('File size must be under 12MB');
            }
            const chosenField = field;
            const publicUrl = await resourceApi.uploadPdf(file);
            await uploadResource(file, chosenField, publicUrl);

            setMessage({ text: 'Resource uploaded successfully!', type: 'success' });
            setTitle('');
            setFile(null);
            setDeadline('');
            e.target.reset();
        } catch (err) {
            setMessage({ text: err.message, type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="page-container module-page">
            <div className="page-content module-content">
                <div className="module-header">
                    <p className="module-kicker">Resources</p>
                    <h1>Upload Resource</h1>
                </div>
                <p className="module-subtext">
                    Share notes or assignments with your students.
                </p>

                <div className="module-upload-grid">
                    <form onSubmit={handleUpload} className="auth-form module-form-panel module-upload-form">
                        <div className="module-upload-form-head">
                            <p className="module-kicker">New Resource</p>
                            <h2>Publish to Students</h2>
                        </div>

                        <div className="form-group">
                            <label>Resource Title</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Unit 1: Introduction to Neural Networks"
                            />
                        </div>

                        <div className="module-upload-row">

                            <div className="form-group">
                                <label>Type</label>
                                <select value={type} onChange={(e) => setType(e.target.value)}>
                                    <option value="note">Note (PDF)</option>
                                    <option value="assignment">Assignment</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Subject</label>
                                <select value={subject} onChange={e => setSubject(e.target.value)} required>
                                    {allowedSubjects.length === 0 && <option value="">No subjects available</option>}
                                    {allowedSubjects.map(subj => (
                                        <option key={subj} value={subj}>{subj}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Field of Study</label>
                                <select value={field} onChange={(e) => setField(e.target.value)}>
                                    {allowedFields.length === 0 && <option value="">Select subject first</option>}
                                    {allowedFields.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="module-upload-row">
                            <div className="form-group">
                                <label>Semester</label>
                                <select value={semester} onChange={(e) => setSemester(e.target.value)}>
                                    {allowedSemesters.length === 0 && <option value="">-</option>}
                                    {allowedSemesters.map(s => <option key={s} value={s}>Sem {s}</option>)}
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Section</label>
                                <select value={section} onChange={(e) => setSection(e.target.value)}>
                                    {allowedSections.length === 0 && <option value="">-</option>}
                                    {allowedSections.map(s => <option key={s} value={s}>Sec {s}</option>)}
                                </select>
                            </div>
                        </div>

                        {type === 'assignment' && (
                            <div className="form-group">
                                <label>Deadline</label>
                                <input
                                    type="text"
                                    placeholder="YYYY-MM-DD"
                                    value={deadline}
                                    onChange={(e) => setDeadline(e.target.value)}
                                    required
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label>Document File</label>
                            <label className="module-file-drop">
                                <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,.ppt,.pptx"
                                    onChange={(e) => setFile(e.target.files[0])}
                                    required
                                />
                                <span className="title">Choose File (PDF, DOCX, PPTX)</span>
                                <span className="subtitle">Max 12MB. Upload a clean, readable document.</span>
                            </label>
                            {file ? (
                                <div className="module-file-meta">
                                    <span>{file.name}</span>
                                    <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                </div>
                            ) : null}
                        </div>

                        {message.text && (
                            <div className={`auth-error ${message.type === 'success' ? 'success-msg' : ''}`}
                                style={{
                                    borderColor: message.type === 'success' ? '#fff' : '#333',
                                    color: message.type === 'success' ? '#fff' : '#888',
                                    background: message.type === 'success' ? '#111' : '#000'
                                }}>
                                {message.text}
                            </div>
                        )}

                        <button type="submit" className="auth-submit" disabled={uploading}>
                            {uploading ? 'Uploading...' : 'Publish Resource'}
                        </button>
                    </form>

                    <aside className="module-panel module-upload-aside">
                        <h3>Publishing Rules</h3>
                        <ul className="module-upload-rules">
                            <li>PDF, DOCX, and PPTX files are accepted.</li>
                            <li>Maximum file size is 12MB.</li>
                            <li>Assignments require a deadline.</li>
                            <li>Students only see resources for their branch.</li>
                        </ul>

                        <div className="module-upload-preview">
                            <p className="module-kicker">Preview</p>
                            <h4>{title || (file?.name ?? 'Untitled Resource')}</h4>
                            <p><strong>Type:</strong> {type === 'assignment' ? 'Assignment' : 'Note'}</p>
                            <p><strong>Field:</strong> {field}</p>
                            <p><strong>Semester:</strong> {semester}</p>
                            <p><strong>Section:</strong> {section}</p>
                            {type === 'assignment' ? <p><strong>Deadline:</strong> {deadline || 'Not set'}</p> : null}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}
