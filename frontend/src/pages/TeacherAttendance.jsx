import { useState } from 'react';
import { useAuth } from '../context/useAuth';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi, teacherAttendanceApi } from '../lib/localBase';
import './Page.css';

const toTitleCase = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'Unknown';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatDateTime = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
};

export default function TeacherAttendance() {
    const { user, profile, loading: authLoading, isTeacher } = useAuth();
    const queryClient = useQueryClient();

    const [rfidUid, setRfidUid] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editStatus, setEditStatus] = useState('present');
    const [message, setMessage] = useState({ text: '', type: '' });
    const [rfidMessage, setRfidMessage] = useState({ text: '', type: '' });
    const [exportMessage, setExportMessage] = useState({ text: '', type: '' });

    const attendanceQuery = useQuery({
        queryKey: ['teacher_attendance', user?.id],
        enabled: !!user && !!profile && isTeacher,
        queryFn: async () => {
            return await teacherAttendanceApi.listForTeacher(user.id);
        },
    });

    const linkRfidMutation = useMutation({
        mutationFn: async (uid) => {
            await profileApi.linkRfid(user.id, uid);
        },
        onSuccess: () => {
            setRfidMessage({ text: 'RFID UID linked successfully!', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['auth_session'] }); // force profile refresh if we had it, but mostly we just care it saved
        },
        onError: (err) => {
            setRfidMessage({ text: err.message || 'Error linking RFID', type: 'error' });
        }
    });

    const updateAttendanceMutation = useMutation({
        mutationFn: async ({ date, status }) => {
            await teacherAttendanceApi.updateAttendance(date, status);
        },
        onSuccess: () => {
            setMessage({ text: 'Attendance updated successfully!', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['teacher_attendance'] });
            setEditDate('');
        },
        onError: (err) => {
            setMessage({ text: err.message || 'Error updating attendance', type: 'error' });
        }
    });

    if (authLoading || attendanceQuery.isLoading) return <div className="page-container module-page"><div className="page-content module-content">Loading...</div></div>;
    if (!user) return <Navigate to="/login" />;
    if (!isTeacher) return <Navigate to="/dashboard" />;

    const records = (attendanceQuery.data ?? []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const teacherLabel = profile?.username || user?.username || user?.email || user?.id || 'teacher';
    const safeTeacherLabel = String(teacherLabel)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'teacher';
    const exportRows = records.map((record, index) => ({
        number: index + 1,
        date: record.date || '-',
        status: toTitleCase(record.status),
        updatedBy: record.updated_by || 'system',
        createdAt: formatDateTime(record.created_at),
        updatedAt: formatDateTime(record.updated_at),
    }));
    
    // Stats calc
    const totalDays = records.length;
    const presentDays = records.filter(r => r.status === 'present').length;
    const leaveDays = records.filter(r => r.status === 'leave').length;
    const holidayDays = records.filter(r => r.status === 'holiday').length;
    const absentDays = records.filter(r => r.status === 'absent').length;

    const handleLinkRfid = (e) => {
        e.preventDefault();
        if (!rfidUid) return;
        linkRfidMutation.mutate(rfidUid);
    };

    const handleUpdateAttendance = (e) => {
        e.preventDefault();
        if (!editDate) return;
        updateAttendanceMutation.mutate({ date: editDate, status: editStatus });
    };

    const handleExportExcel = async () => {
        if (records.length === 0) {
            setExportMessage({ text: 'No attendance records to export.', type: 'error' });
            return;
        }

        try {
            const XLSX = await import('xlsx');
            const worksheet = XLSX.utils.json_to_sheet(
                exportRows.map((row) => ({
                    '#': row.number,
                    Date: row.date,
                    Status: row.status,
                    'Updated By': row.updatedBy,
                    'Created At': row.createdAt,
                    'Updated At': row.updatedAt,
                }))
            );
            worksheet['!cols'] = [
                { wch: 6 },
                { wch: 14 },
                { wch: 12 },
                { wch: 18 },
                { wch: 24 },
                { wch: 24 },
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');

            const stamp = new Date().toISOString().split('T')[0];
            const filename = `teacher-attendance-${safeTeacherLabel}-${stamp}.xlsx`;
            XLSX.writeFile(workbook, filename);
            setExportMessage({ text: `Excel exported: ${filename}`, type: 'success' });
        } catch (error) {
            setExportMessage({ text: `Excel export failed: ${error?.message || 'Unknown error'}`, type: 'error' });
        }
    };

    const handleExportPdf = async () => {
        if (records.length === 0) {
            setExportMessage({ text: 'No attendance records to export.', type: 'error' });
            return;
        }

        try {
            const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
            ]);
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const stamp = new Date().toISOString().split('T')[0];
            const filename = `teacher-attendance-${safeTeacherLabel}-${stamp}.pdf`;

            doc.setFontSize(15);
            doc.text('Teacher Attendance Report', 40, 40);
            doc.setFontSize(10);
            doc.text(`Teacher: ${teacherLabel}`, 40, 60);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 75);

            autoTable(doc, {
                startY: 92,
                head: [['#', 'Date', 'Status', 'Updated By', 'Created At', 'Updated At']],
                body: exportRows.map((row) => [
                    row.number,
                    row.date,
                    row.status,
                    row.updatedBy,
                    row.createdAt,
                    row.updatedAt,
                ]),
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [18, 18, 18], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [245, 245, 245] },
            });

            doc.save(filename);
            setExportMessage({ text: `PDF exported: ${filename}`, type: 'success' });
        } catch (error) {
            setExportMessage({ text: `PDF export failed: ${error?.message || 'Unknown error'}`, type: 'error' });
        }
    };

    return (
        <div className="page-container module-page">
            <div className="page-content module-content">
                <div className="module-header">
                    <p className="module-kicker">Faculty Portal</p>
                    <h1>My Attendance</h1>
                </div>
                
                <p className="module-subtext">
                    Track your daily check-ins, apply for leaves, and manage your hardware RFID linkage.
                </p>

                <div className="module-stats-card" style={{ marginBottom: '2rem' }}>
                    <div className={`module-stats-score good`}>
                        {totalDays > 0 ? Math.round((presentDays / (totalDays - holidayDays || 1)) * 100) : 0}%
                    </div>
                    <p className="module-stats-label">
                        Present / Active Days
                    </p>
                    <div className="module-stats-pairs">
                        <div className="module-stats-pair">
                            <div className="value">{presentDays}</div>
                            <div className="label">Present</div>
                        </div>
                        <div className="module-divider" />
                        <div className="module-stats-pair">
                            <div className="value">{absentDays}</div>
                            <div className="label">Absent</div>
                        </div>
                        <div className="module-divider" />
                        <div className="module-stats-pair">
                            <div className="value">{leaveDays}</div>
                            <div className="label">Leaves</div>
                        </div>
                    </div>
                </div>

                <div className="module-upload-grid">
                    <form onSubmit={handleUpdateAttendance} className="auth-form module-form-panel module-upload-form">
                        <div className="module-upload-form-head">
                            <p className="module-kicker">Self Service</p>
                            <h2>Update Attendance</h2>
                        </div>
                        <div className="filters-container">
                            <div className="form-group">
                                <label>Date</label>
                                <input 
                                    type="text" 
                                    placeholder="YYYY-MM-DD"
                                    value={editDate} 
                                    onChange={e => setEditDate(e.target.value)} 
                                    required 
                                />
                            </div>
                            <div className="form-group">
                                <label>Status</label>
                                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                                    <option value="present">Present</option>
                                    <option value="absent">Absent</option>
                                    <option value="leave">Leave Request</option>
                                    <option value="holiday">Holiday / Non-Working</option>
                                </select>
                            </div>
                        </div>
                        {message.text && (
                            <div className={`auth-error ${message.type === 'success' ? 'success-msg' : ''}`}
                                style={{
                                    borderColor: message.type === 'success' ? '#fff' : '#333',
                                    color: message.type === 'success' ? '#fff' : '#888',
                                    background: message.type === 'success' ? '#111' : '#000',
                                    marginBottom: '1rem'
                                }}>
                                {message.text}
                            </div>
                        )}
                        <button type="submit" className="module-btn" style={{ width: '100%', marginTop: '0.5rem' }} disabled={updateAttendanceMutation.isPending}>
                            {updateAttendanceMutation.isPending ? 'Updating...' : 'Save Record'}
                        </button>
                    </form>
                </div>

                <div className="module-panel attendance-list-panel" style={{ marginTop: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
                        <h2 style={{ margin: 0 }}>Recent Check-ins & Reports</h2>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" className="module-btn" onClick={handleExportExcel} disabled={records.length === 0}>
                                Export Excel
                            </button>
                            <button type="button" className="module-btn ghost" onClick={handleExportPdf} disabled={records.length === 0}>
                                Export PDF
                            </button>
                        </div>
                    </div>
                    {exportMessage.text && (
                        <div
                            className={`auth-error ${exportMessage.type === 'success' ? 'success-msg' : ''}`}
                            style={{
                                borderColor: exportMessage.type === 'success' ? '#fff' : '#333',
                                color: exportMessage.type === 'success' ? '#fff' : '#888',
                                background: exportMessage.type === 'success' ? '#111' : '#000',
                                marginBottom: '1rem'
                            }}
                        >
                            {exportMessage.text}
                        </div>
                    )}
                    <div className="module-list">
                        {records.length === 0 && (
                            <div className="module-list-row" style={{ justifyContent: 'center', color: 'var(--color-gray)' }}>
                                No attendance records found.
                            </div>
                        )}
                        {records.map(record => (
                            <div key={record.id} className="module-list-row">
                                <div>
                                    <span style={{ display: 'block', fontWeight: '500' }}>{record.date}</span>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>Updated by: {record.updated_by}</span>
                                </div>
                                <span className={`status-${record.status === 'present' ? 'good' : record.status === 'leave' || record.status === 'holiday' ? 'warn' : 'error'}`} style={{ textTransform: 'capitalize' }}>
                                    {record.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
