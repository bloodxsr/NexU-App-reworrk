import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import './Page.css';
import { attendanceApi, profileApi } from '../lib/localBase';

const SUBJECT_OPTIONS = [
    'Electrical Science', 'Applied Mathematics I', 'Engineering Graphics', 'Manufacturing Processes',
    'Communication Skills', 'Applied Physics I', 'Indian Constitution', 'Engineering Mechanics',
    'Programming in C', 'Workshop Practice', 'Environmental Science', 'Applied Chemistry',
    'Human Values and Professional Ethics', 'Applied Physics II', 'Applied Mathematics II',
    'Probability, Statistics and Linear Algebra', 'Data Structures', 'Critical Reasoning and System Thinking',
    'Digital Logic Design', 'Universal Human Values', 'Principles of Artificial Intelligence'
];
const TEACHER_MODE = {
    SUBJECT: 'subject',
    HOMEROOM: 'homeroom',
};

const normalizeClassValue = (value) => String(value || '').trim().toUpperCase();
const normalizeSemesterValue = (value) => String(value || '').trim();
const classKey = (field, semester, section) => `${normalizeClassValue(field)}|${normalizeSemesterValue(semester)}|${normalizeClassValue(section)}`;

const toIsoDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.length >= 10 ? raw.slice(0, 10) : raw;
};

const isWithinRange = (date, fromDate, toDate) => {
    if (!date) return false;
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
};

const normalizeAttendanceRows = (records, fromDate, toDate) => {
    return (records ?? [])
        .map((record) => ({
            date: toIsoDate(record.date),
            subject: String(record.subject || '').trim(),
            status: String(record.status || '').trim().toLowerCase(),
        }))
        .filter((record) => isWithinRange(record.date, fromDate, toDate));
};

const summarizeAttendanceCounts = (records) => {
    const presentCount = records.filter((record) => record.status === 'present').length;
    const totalCount = records.length;
    const absentCount = Math.max(totalCount - presentCount, 0);
    const attendancePct = totalCount > 0 ? Number(((presentCount / totalCount) * 100).toFixed(1)) : 0;
    return {
        presentCount,
        absentCount,
        totalCount,
        attendancePct,
    };
};

const buildSubjectAverages = (records, baseSubjects = SUBJECT_OPTIONS) => {
    const subjectOrder = [];
    const subjectStats = new Map();

    const ensureSubject = (subject) => {
        const normalized = String(subject || '').trim();
        if (!normalized || subjectStats.has(normalized)) return;
        subjectOrder.push(normalized);
        subjectStats.set(normalized, { subject: normalized, presentCount: 0, totalCount: 0 });
    };

    for (const subject of baseSubjects) {
        ensureSubject(subject);
    }

    for (const record of records) {
        ensureSubject(record.subject);
        const entry = subjectStats.get(record.subject);
        if (!entry) continue;
        entry.totalCount += 1;
        if (record.status === 'present') {
            entry.presentCount += 1;
        }
    }

    return subjectOrder.map((subject) => {
        const entry = subjectStats.get(subject) || { presentCount: 0, totalCount: 0 };
        const absentCount = Math.max(entry.totalCount - entry.presentCount, 0);
        const attendancePct = entry.totalCount > 0
            ? Number(((entry.presentCount / entry.totalCount) * 100).toFixed(1))
            : 0;
        return {
            subject,
            presentCount: entry.presentCount,
            absentCount,
            totalCount: entry.totalCount,
            attendancePct,
        };
    });
};

export default function Attendance() {
    const { user, profile, profileError, loading: authLoading, isTeacher, isStudent, isAdmin } = useAuth();
    const [selectedStudents, setSelectedStudents] = useState({});
    const [selectedField, setSelectedField] = useState('ALL');
    const [selectedSemester, setSelectedSemester] = useState('ALL');
    const [selectedSection, setSelectedSection] = useState('ALL');
    const [studentSearch, setStudentSearch] = useState('');
    const [tempSearch, setTempSearch] = useState('');
    const [teacherMode, setTeacherMode] = useState(TEACHER_MODE.SUBJECT);
    const [teacherSubject, setTeacherSubject] = useState('Physics');
    const [homeRoomSubject, setHomeRoomSubject] = useState('ALL');
    const [studentSubject, setStudentSubject] = useState('ALL');
    const [message, setMessage] = useState('');
    const [exportFromDate, setExportFromDate] = useState('');
    const [exportToDate, setExportToDate] = useState('');
    const [exportMessage, setExportMessage] = useState({ text: '', type: '' });
    const [isExporting, setIsExporting] = useState(false);
    const queryClient = useQueryClient();

    const studentsQuery = useQuery({
        queryKey: ['students', selectedField, studentSearch],
        enabled: !!user && !!profile && isTeacher,
        queryFn: async () => {
            return await profileApi.listStudents(selectedField, studentSearch);
        },
    });

    const teacherAccessQuery = useQuery({
        queryKey: ['teacher-access', user?.id],
        enabled: !!user && !!profile && isTeacher,
        queryFn: async () => {
            return await profileApi.getMyTeacherAccess();
        },
    });

    const attendanceQuery = useQuery({
        queryKey: ['attendance', user?.id, studentSubject],
        enabled: !!user && !!profile && isStudent,
        queryFn: async () => {
            const data = await attendanceApi.listForStudent(user.id, studentSubject);
            return (data ?? []).map((record) => ({
                ...record,
                status: String(record.status || '').trim().toLowerCase(),
            }));
        },
    });

    const saveAttendanceMutation = useMutation({
        mutationFn: async (records) => {
            await attendanceApi.upsertMany(records);
        },
        onSuccess: () => {
            setMessage(`Attendance saved successfully for ${new Date().toISOString().split('T')[0]} (${teacherSubject})`);
            queryClient.invalidateQueries({ queryKey: ['students'] });
            queryClient.invalidateQueries({ queryKey: ['attendance'] });
        },
        onError: (err) => {
            setMessage('Error saving attendance: ' + (err?.message || 'Unknown error'));
        },
    });

    const teacherAccess = teacherAccessQuery.data ?? {
        subject_access: [],
        home_classes: [],
        allowed_classes: [],
    };
    const teacherSubjectAccess = teacherAccess.subject_access ?? [];
    const teacherHomeClasses = teacherAccess.home_classes ?? [];

    const subjectClassTuples = useMemo(() => {
        const deduped = new Map();
        for (const item of teacherSubjectAccess) {
            const field = normalizeClassValue(item.field_of_study);
            const semester = normalizeSemesterValue(item.semester);
            const section = normalizeClassValue(item.section);
            if (!field || !semester || !section) continue;
            deduped.set(classKey(field, semester, section), {
                field_of_study: field,
                semester,
                section,
            });
        }
        return Array.from(deduped.values()).sort((a, b) => {
            if (a.field_of_study !== b.field_of_study) return a.field_of_study.localeCompare(b.field_of_study);
            if (Number(a.semester) !== Number(b.semester)) return Number(a.semester) - Number(b.semester);
            return a.section.localeCompare(b.section);
        });
    }, [teacherSubjectAccess]);

    const homeRoomClassTuples = useMemo(() => {
        const deduped = new Map();
        for (const item of teacherHomeClasses) {
            const field = normalizeClassValue(item.field_of_study);
            const semester = normalizeSemesterValue(item.semester);
            const section = normalizeClassValue(item.section);
            if (!field || !semester || !section) continue;
            deduped.set(classKey(field, semester, section), {
                field_of_study: field,
                semester,
                section,
            });
        }
        return Array.from(deduped.values()).sort((a, b) => {
            if (a.field_of_study !== b.field_of_study) return a.field_of_study.localeCompare(b.field_of_study);
            if (Number(a.semester) !== Number(b.semester)) return Number(a.semester) - Number(b.semester);
            return a.section.localeCompare(b.section);
        });
    }, [teacherHomeClasses]);

    const activeClassTuples = teacherMode === TEACHER_MODE.SUBJECT ? subjectClassTuples : homeRoomClassTuples;

    const activeClassKeySet = useMemo(() => {
        return new Set(activeClassTuples.map((item) => classKey(item.field_of_study, item.semester, item.section)));
    }, [activeClassTuples]);

    const subjectAssignmentKeySet = useMemo(() => {
        const keys = new Set();
        for (const item of teacherSubjectAccess) {
            const field = normalizeClassValue(item.field_of_study);
            const semester = normalizeSemesterValue(item.semester);
            const section = normalizeClassValue(item.section);
            const subject = String(item.subject || '').trim();
            if (!field || !semester || !section || !subject) continue;
            keys.add(`${classKey(field, semester, section)}|${subject}`);
        }
        return keys;
    }, [teacherSubjectAccess]);

    const branchOptions = useMemo(() => {
        return [...new Set(activeClassTuples.map((item) => item.field_of_study).filter(Boolean))].sort();
    }, [activeClassTuples]);

    const semesterOptionsForTeacher = useMemo(() => {
        return [...new Set(activeClassTuples.map((item) => item.semester).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    }, [activeClassTuples]);

    const sectionOptionsForTeacher = useMemo(() => {
        return [...new Set(activeClassTuples.map((item) => item.section).filter(Boolean))].sort();
    }, [activeClassTuples]);

    const subjectOptionsForSelection = useMemo(() => {
        if (!isTeacher) return SUBJECT_OPTIONS;
        if (teacherMode === TEACHER_MODE.HOMEROOM) return ['ALL'];

        const allowedSubjects = new Set();
        for (const item of teacherSubjectAccess) {
            const field = normalizeClassValue(item.field_of_study);
            const semester = normalizeSemesterValue(item.semester);
            const section = normalizeClassValue(item.section);
            const subject = String(item.subject || '').trim();

            const fieldMatches = selectedField === 'ALL' || field === selectedField;
            const semesterMatches = selectedSemester === 'ALL' || semester === selectedSemester;
            const sectionMatches = selectedSection === 'ALL' || section === selectedSection;

            if (fieldMatches && semesterMatches && sectionMatches && subject) {
                allowedSubjects.add(subject);
            }
        }
        return SUBJECT_OPTIONS.filter((subject) => allowedSubjects.has(subject));
    }, [isTeacher, teacherMode, teacherSubjectAccess, selectedField, selectedSemester, selectedSection]);

    const activeSubject = teacherMode === TEACHER_MODE.SUBJECT ? teacherSubject : homeRoomSubject;

    const students = studentsQuery.data ?? [];
    const filteredStudents = students.filter((student) => {
        const studentField = normalizeClassValue(student.field_of_study);
        const studentSemester = normalizeSemesterValue(student.semester);
        const studentSection = normalizeClassValue(student.section);
        const studentClassKey = classKey(studentField, studentSemester, studentSection);

        const fieldMatches = selectedField === 'ALL' || studentField === selectedField;
        const semesterMatches = selectedSemester === 'ALL' || studentSemester === selectedSemester;
        const sectionMatches = selectedSection === 'ALL' || studentSection === selectedSection;

        return fieldMatches && semesterMatches && sectionMatches && activeClassKeySet.has(studentClassKey);
    });
    const attendanceRecords = attendanceQuery.data ?? [];
    const loading = isTeacher
        ? (studentsQuery.isLoading || teacherAccessQuery.isLoading)
        : attendanceQuery.isLoading;
    const saving = saveAttendanceMutation.isPending;
    const hasSubjectAssignments = subjectClassTuples.length > 0;
    const hasActiveAssignments = activeClassTuples.length > 0;
    const filteredStudentIdKey = useMemo(
        () => filteredStudents.map((student) => student.id).sort().join('|'),
        [filteredStudents]
    );

    const homeroomAveragesQuery = useQuery({
        queryKey: ['homeroom-averages', user?.id, filteredStudentIdKey, exportFromDate, exportToDate],
        enabled:
            !!user &&
            !!profile &&
            isTeacher &&
            teacherMode === TEACHER_MODE.HOMEROOM &&
            hasActiveAssignments &&
            filteredStudents.length > 0,
        queryFn: async () => {
            const results = await Promise.allSettled(
                filteredStudents.map(async (student) => {
                    const rawRecords = await attendanceApi.listForStudent(student.id, 'ALL');
                    const normalized = normalizeAttendanceRows(rawRecords, exportFromDate, exportToDate);
                    const subjectAverages = buildSubjectAverages(normalized, SUBJECT_OPTIONS);
                    const overall = summarizeAttendanceCounts(normalized);

                    return {
                        studentId: student.id,
                        subjectAverages,
                        overallAttendancePct: overall.attendancePct,
                        overallPresentCount: overall.presentCount,
                        overallTotalCount: overall.totalCount,
                    };
                })
            );

            const byStudentId = {};
            let failedCount = 0;

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    byStudentId[result.value.studentId] = result.value;
                } else {
                    failedCount += 1;
                }
            }

            return { byStudentId, failedCount };
        },
    });

    const homeroomAveragesByStudent = homeroomAveragesQuery.data?.byStudentId ?? {};

    useEffect(() => {
        if (studentsQuery.error) {
            setTimeout(() => setMessage('Error fetching students: ' + studentsQuery.error.message), 0);
        } else if (teacherAccessQuery.error) {
            setTimeout(() => setMessage('Error loading teacher access constraints: ' + teacherAccessQuery.error.message), 0);
        } else if (attendanceQuery.error) {
            setTimeout(() => setMessage('Error fetching attendance: ' + attendanceQuery.error.message), 0);
        }
    }, [studentsQuery.error, teacherAccessQuery.error, attendanceQuery.error]);

    useEffect(() => {
        if (!isTeacher) return;
        if (teacherMode === TEACHER_MODE.SUBJECT) {
            if (subjectOptionsForSelection.length === 0) {
                if (teacherSubject !== '') {
                    setTeacherSubject('');
                }
                return;
            }
            if (!subjectOptionsForSelection.includes(teacherSubject)) {
                setTeacherSubject(subjectOptionsForSelection[0]);
            }
            return;
        }

        if (homeRoomSubject !== 'ALL') {
            setHomeRoomSubject('ALL');
        }
    }, [isTeacher, teacherMode, subjectOptionsForSelection, teacherSubject, homeRoomSubject]);

    useEffect(() => {
        if (isTeacher) {
            setTimeout(() => setSelectedStudents({}), 0);
        }
    }, [isTeacher, teacherMode, selectedField, selectedSemester, selectedSection, teacherSubject, homeRoomSubject, studentSearch]);

    const handleCheckboxChange = (studentId) => {
        setSelectedStudents(prev => ({
            ...prev,
            [studentId]: !prev[studentId]
        }));
    };

    const canMarkStudentForSubject = (student, subject) => {
        if (!subject) return false;
        const key = `${classKey(student.field_of_study, student.semester, student.section)}|${subject}`;
        return subjectAssignmentKeySet.has(key);
    };

    const saveAttendance = async () => {
        if (teacherMode !== TEACHER_MODE.SUBJECT) {
            setMessage('Use Subject Attendance to mark records. Home Room Attendance is for view and export.');
            return;
        }
        if (!teacherSubject) {
            setMessage('Error saving attendance: Select a subject first.');
            return;
        }

        const today = new Date().toISOString().split('T')[0];

        const markableStudents = filteredStudents.filter((student) => canMarkStudentForSubject(student, teacherSubject));

        const records = markableStudents.map(student => ({
            student_id: student.id,
            date: today,
            subject: teacherSubject,
            status: selectedStudents[student.id] ? 'present' : 'absent',
            marked_by: user.id
        }));

        if (records.length === 0) {
            setMessage('Error saving attendance: No students in this view are assigned to you for this subject');
            return;
        }

        saveAttendanceMutation.mutate(records);
    };

    const buildExportRows = async () => {
        const exportSubject = teacherMode === TEACHER_MODE.HOMEROOM ? 'ALL' : (activeSubject || 'ALL');
        const exportResults = await Promise.allSettled(
            filteredStudents.map(async (student) => {
                const rawRecords = await attendanceApi.listForStudent(student.id, exportSubject);
                const normalized = normalizeAttendanceRows(rawRecords, exportFromDate, exportToDate);
                const scopedRecords = exportSubject === 'ALL'
                    ? normalized
                    : normalized.filter((record) => record.subject === exportSubject);
                const scopedSummary = summarizeAttendanceCounts(scopedRecords);
                const overallSummary = summarizeAttendanceCounts(normalized);
                const subjectAverages = buildSubjectAverages(normalized, SUBJECT_OPTIONS);
                const subjectAverageMap = Object.fromEntries(
                    subjectAverages.map((entry) => [entry.subject, entry.attendancePct])
                );

                return {
                    studentName: student.username || student.email || 'Unknown',
                    studentEmail: student.email || '-',
                    studentId: student.id,
                    field: student.field_of_study || '-',
                    semester: student.semester || '-',
                    section: String(student.section || '-').toUpperCase(),
                    subject: exportSubject === 'ALL' ? 'All Subjects' : exportSubject,
                    presentCount: scopedSummary.presentCount,
                    absentCount: scopedSummary.absentCount,
                    totalCount: scopedSummary.totalCount,
                    attendancePct: scopedSummary.attendancePct,
                    overallAttendancePct: overallSummary.attendancePct,
                    subjectAverages,
                    subjectAverageMap,
                };
            })
        );

        const rows = exportResults
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value)
            .sort((a, b) => a.studentName.localeCompare(b.studentName));

        const failedCount = exportResults.length - rows.length;
        return { rows, failedCount };
    };

    const handleExportSectionExcel = async () => {
        const exportSubject = teacherMode === TEACHER_MODE.HOMEROOM ? 'ALL' : (activeSubject || 'ALL');
        if (filteredStudents.length === 0) {
            setExportMessage({ text: 'No students found for the selected section filters.', type: 'error' });
            return;
        }
        if (teacherMode === TEACHER_MODE.SUBJECT && !teacherSubject) {
            setExportMessage({ text: 'Select a subject before exporting.', type: 'error' });
            return;
        }
        if (exportFromDate && exportToDate && exportFromDate > exportToDate) {
            setExportMessage({ text: 'From date cannot be after To date.', type: 'error' });
            return;
        }

        setIsExporting(true);
        setExportMessage({ text: 'Preparing Excel export...', type: 'success' });
        try {
            const { rows, failedCount } = await buildExportRows();
            const XLSX = await import('xlsx');

            const worksheetRows = rows.map((row, index) => {
                const common = {
                    '#': index + 1,
                    Student: row.studentName,
                    Email: row.studentEmail,
                    'Student ID': row.studentId,
                    Branch: row.field,
                    Semester: row.semester,
                    Section: row.section,
                };

                if (teacherMode === TEACHER_MODE.HOMEROOM) {
                    return {
                        ...common,
                        'Physics %': row.subjectAverageMap?.Physics ?? 0,
                        'Chemistry %': row.subjectAverageMap?.Chemistry ?? 0,
                        'Maths %': row.subjectAverageMap?.Maths ?? 0,
                        'Overall %': row.overallAttendancePct ?? row.attendancePct,
                        'From Date': exportFromDate || 'Start',
                        'To Date': exportToDate || 'Latest',
                    };
                }

                return {
                    ...common,
                    Subject: row.subject,
                    Present: row.presentCount,
                    Absent: row.absentCount,
                    Total: row.totalCount,
                    'Attendance %': row.attendancePct,
                    'From Date': exportFromDate || 'Start',
                    'To Date': exportToDate || 'Latest',
                };
            });

            const worksheet = XLSX.utils.json_to_sheet(worksheetRows);

            worksheet['!cols'] = teacherMode === TEACHER_MODE.HOMEROOM
                ? [
                    { wch: 5 },
                    { wch: 18 },
                    { wch: 26 },
                    { wch: 15 },
                    { wch: 10 },
                    { wch: 10 },
                    { wch: 12 },
                    { wch: 12 },
                    { wch: 10 },
                    { wch: 10 },
                    { wch: 12 },
                    { wch: 12 },
                ]
                : [
                    { wch: 5 },
                    { wch: 18 },
                    { wch: 26 },
                    { wch: 15 },
                    { wch: 10 },
                    { wch: 10 },
                    { wch: 10 },
                    { wch: 12 },
                    { wch: 10 },
                    { wch: 10 },
                    { wch: 8 },
                    { wch: 12 },
                    { wch: 12 },
                    { wch: 12 },
                ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Section Attendance');

            const stamp = new Date().toISOString().split('T')[0];
            const fieldSlug = selectedField === 'ALL' ? 'all-branches' : selectedField.toLowerCase();
            const semSlug = selectedSemester === 'ALL' ? 'all-semesters' : `sem-${selectedSemester}`;
            const secSlug = selectedSection === 'ALL' ? 'all-sections' : `sec-${selectedSection.toLowerCase()}`;
            const subjectSlug = exportSubject === 'ALL' ? 'all-subjects' : exportSubject.toLowerCase();
            const prefix = teacherMode === TEACHER_MODE.HOMEROOM ? 'homeroom-attendance' : 'subject-attendance';
            const filename = `${prefix}-${fieldSlug}-${semSlug}-${secSlug}-${subjectSlug}-${stamp}.xlsx`;

            XLSX.writeFile(workbook, filename);
            if (failedCount > 0) {
                setExportMessage({ text: `Excel exported with partial data: ${filename} (${failedCount} students failed to load).`, type: 'error' });
            } else {
                setExportMessage({ text: `Excel exported: ${filename}`, type: 'success' });
            }
        } catch (error) {
            setExportMessage({ text: `Excel export failed: ${error?.message || 'Unknown error'}`, type: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportSectionPdf = async () => {
        const exportSubject = teacherMode === TEACHER_MODE.HOMEROOM ? 'ALL' : (activeSubject || 'ALL');
        if (filteredStudents.length === 0) {
            setExportMessage({ text: 'No students found for the selected section filters.', type: 'error' });
            return;
        }
        if (teacherMode === TEACHER_MODE.SUBJECT && !teacherSubject) {
            setExportMessage({ text: 'Select a subject before exporting.', type: 'error' });
            return;
        }
        if (exportFromDate && exportToDate && exportFromDate > exportToDate) {
            setExportMessage({ text: 'From date cannot be after To date.', type: 'error' });
            return;
        }

        setIsExporting(true);
        setExportMessage({ text: 'Preparing PDF export...', type: 'success' });
        try {
            const { rows, failedCount } = await buildExportRows();
            const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
            ]);

            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const stamp = new Date().toISOString().split('T')[0];
            const fieldLabel = selectedField === 'ALL' ? 'All Branches' : selectedField;
            const semLabel = selectedSemester === 'ALL' ? 'All Semesters' : `Semester ${selectedSemester}`;
            const secLabel = selectedSection === 'ALL' ? 'All Sections' : `Section ${selectedSection}`;
            const rangeLabel = `${exportFromDate || 'Start'} to ${exportToDate || 'Latest'}`;
            const exportSubjectLabel = exportSubject === 'ALL' ? 'All Subjects' : exportSubject;
            const isHomeroomExport = teacherMode === TEACHER_MODE.HOMEROOM;

            doc.setFontSize(15);
            doc.text(teacherMode === TEACHER_MODE.HOMEROOM ? 'Home Room Attendance Report' : 'Subject Attendance Report', 40, 40);
            doc.setFontSize(10);
            doc.text(`Branch: ${fieldLabel} | ${semLabel} | ${secLabel}`, 40, 60);
            doc.text(
                `${isHomeroomExport ? 'Subject Scope: All Subjects (Average)' : `Subject: ${exportSubjectLabel}`} | Date Range: ${rangeLabel}`,
                40,
                74
            );
            doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 88);

            const head = isHomeroomExport
                ? [['#', 'Student', 'Email', 'Branch', 'Section', 'Physics %', 'Chemistry %', 'Maths %', 'Overall %']]
                : [['#', 'Student', 'Email', 'Branch', 'Section', 'Present', 'Absent', 'Total', 'Attendance %']];

            const body = isHomeroomExport
                ? rows.map((row, index) => [
                    index + 1,
                    row.studentName,
                    row.studentEmail,
                    row.field,
                    row.section,
                    `${row.subjectAverageMap?.Physics ?? 0}%`,
                    `${row.subjectAverageMap?.Chemistry ?? 0}%`,
                    `${row.subjectAverageMap?.Maths ?? 0}%`,
                    `${row.overallAttendancePct ?? row.attendancePct}%`,
                ])
                : rows.map((row, index) => [
                    index + 1,
                    row.studentName,
                    row.studentEmail,
                    row.field,
                    row.section,
                    row.presentCount,
                    row.absentCount,
                    row.totalCount,
                    `${row.attendancePct}%`,
                ]);

            autoTable(doc, {
                startY: 104,
                head,
                body,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [18, 18, 18], textColor: [255, 255, 255] },
                alternateRowStyles: { fillColor: [245, 245, 245] },
            });

            const fieldSlug = selectedField === 'ALL' ? 'all-branches' : selectedField.toLowerCase();
            const semSlug = selectedSemester === 'ALL' ? 'all-semesters' : `sem-${selectedSemester}`;
            const secSlug = selectedSection === 'ALL' ? 'all-sections' : `sec-${selectedSection.toLowerCase()}`;
            const subjectSlug = exportSubject === 'ALL' ? 'all-subjects' : exportSubject.toLowerCase();
            const prefix = teacherMode === TEACHER_MODE.HOMEROOM ? 'homeroom-attendance' : 'subject-attendance';
            const filename = `${prefix}-${fieldSlug}-${semSlug}-${secSlug}-${subjectSlug}-${stamp}.pdf`;
            doc.save(filename);

            if (failedCount > 0) {
                setExportMessage({ text: `PDF exported with partial data: ${filename} (${failedCount} students failed to load).`, type: 'error' });
            } else {
                setExportMessage({ text: `PDF exported: ${filename}`, type: 'success' });
            }
        } catch (error) {
            setExportMessage({ text: `PDF export failed: ${error?.message || 'Unknown error'}`, type: 'error' });
        } finally {
            setIsExporting(false);
        }
    };

    if (authLoading || (loading && ((isTeacher && students.length === 0) || (isStudent && attendanceRecords.length === 0)))) return <div className="page-container module-page"><div className="page-content module-content">Loading...</div></div>;
    if (!user) return <Navigate to="/login" />;
    if (profileError) return <div className="page-container module-page"><div className="page-content module-content">{profileError}</div></div>;
    if (!profile) return <div className="page-container module-page"><div className="page-content module-content">Profile not found. Please sign out and log in again.</div></div>;
    if (!isTeacher && !isStudent) return <div className="page-container module-page"><div className="page-content module-content">Unable to load attendance: invalid user role in profile.</div></div>;

    // STUDENT VIEW
    if (isStudent) {
        const totalClasses = attendanceRecords.length;
        const attendedClasses = attendanceRecords.filter(r => String(r.status || '').trim().toLowerCase() === 'present').length;
        const percentage = totalClasses > 0 ? ((attendedClasses / totalClasses) * 100).toFixed(1) : 0;
        const isRefreshing = attendanceQuery.isFetching && !attendanceQuery.isLoading;

        return (
            <div className="page-container module-page">
                <div className="page-content module-content">
                    <div className="module-header">
                        <p className="module-kicker">Attendance</p>
                        <h1>My Attendance</h1>
                    </div>
                    {isRefreshing && (
                        <p className="module-refreshing">
                            Refreshing...
                        </p>
                    )}
                    <div className="form-group module-filter">
                        <label>Subject</label>
                        <select value={studentSubject} onChange={(e) => setStudentSubject(e.target.value)}>
                            <option value="ALL">All Subjects</option>
                            {SUBJECT_OPTIONS.map((subject) => (
                                <option key={subject} value={subject}>{subject}</option>
                            ))}
                        </select>
                    </div>
                    <div className="module-stats-card">
                        <div className={`module-stats-score ${Number(percentage) >= 75 ? 'good' : 'warn'}`}>
                            {percentage}%
                        </div>
                        <p className="module-stats-label">
                            Overall Attendance
                        </p>
                        <div className="module-stats-pairs">
                            <div className="module-stats-pair">
                                <div className="value">{attendedClasses}</div>
                                <div className="label">Present</div>
                            </div>
                            <div className="module-divider" />
                            <div className="module-stats-pair">
                                <div className="value">{totalClasses}</div>
                                <div className="label">Total</div>
                            </div>
                        </div>
                    </div>

                    <div className="module-panel attendance-list-panel">
                        <h2>Recent History</h2>
                        <div className="module-list">
                            {attendanceRecords.slice().reverse().map(record => (
                                <div key={record.id} className="module-list-row">
                                    <span>{record.date}</span>
                                    <span className={String(record.status || '').trim().toLowerCase() === 'present' ? 'status-good' : 'status-warn'}>
                                        {String(record.status || '').toUpperCase()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // TEACHER VIEW
    return (
        <div className="page-container module-page">
            <div className="page-content module-content">
                <div className="module-header">
                    <p className="module-kicker">Attendance</p>
                    <h1>Mark Attendance</h1>
                </div>
                {studentsQuery.isFetching && !studentsQuery.isLoading && (
                    <p className="module-refreshing">
                        Refreshing...
                    </p>
                )}
                {teacherMode === TEACHER_MODE.HOMEROOM && homeroomAveragesQuery.isFetching && (
                    <p className="module-refreshing">
                        Loading subject-wise averages from ScyllaDB...
                    </p>
                )}
                <div className="attendance-mode-toggle" role="tablist" aria-label="Attendance Mode">
                    <button
                        type="button"
                        className={`attendance-mode-btn ${teacherMode === TEACHER_MODE.SUBJECT ? 'active' : ''}`}
                        onClick={() => setTeacherMode(TEACHER_MODE.SUBJECT)}
                    >
                        Subject Attendance
                    </button>
                    <button
                        type="button"
                        className={`attendance-mode-btn ${teacherMode === TEACHER_MODE.HOMEROOM ? 'active' : ''}`}
                        onClick={() => setTeacherMode(TEACHER_MODE.HOMEROOM)}
                    >
                        Home Room Attendance
                    </button>
                </div>

                <p className="module-subtext" style={{ marginTop: '1rem' }}>
                    {teacherMode === TEACHER_MODE.SUBJECT
                        ? 'Mark subject-wise attendance for classes assigned to your teaching load.'
                        : 'View and export subject-wise attendance averages for your home room classes.'}
                </p>
                <p className="module-subtext">
                    Field: {selectedField === 'ALL' ? 'All Branches' : selectedField}
                    {' | '}Semester: {selectedSemester === 'ALL' ? 'All' : selectedSemester}
                    {' | '}Section: {selectedSection === 'ALL' ? 'All' : selectedSection}
                    {' | '}{teacherMode === TEACHER_MODE.SUBJECT ? 'Subject' : 'Subject Scope'}: {teacherMode === TEACHER_MODE.HOMEROOM ? 'All Subjects (Average)' : (activeSubject || 'Not selected')}
                    {' | '}Date: {new Date().toLocaleDateString()}
                </p>
                {!hasActiveAssignments && (
                    <div className="module-message error" style={{ marginBottom: '1rem' }}>
                        {teacherMode === TEACHER_MODE.SUBJECT
                            ? 'No subject attendance class is assigned to your account yet.'
                            : 'No home room class is assigned to your account yet.'}
                    </div>
                )}
                <div className="filters-container">
                    <div className="form-group module-filter">
                        <label>Search Student</label>
                        <input
                            type="search"
                            value={tempSearch}
                            onChange={(e) => setTempSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') setStudentSearch(tempSearch);
                            }}
                            placeholder="Type name and press Enter to search..."
                            disabled={!hasActiveAssignments}
                        />
                    </div>
                    <div className="form-group module-filter">
                        <label>Filter Branch</label>
                        <select value={selectedField} onChange={(e) => setSelectedField(e.target.value)} disabled={!hasActiveAssignments}>
                            <option value="ALL">{teacherMode === TEACHER_MODE.SUBJECT ? 'All Subject Branches' : 'All Home Room Branches'}</option>
                            {branchOptions.map((branch) => (
                                <option key={branch} value={branch}>{branch}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group module-filter">
                        <label>Filter Semester</label>
                        <select value={selectedSemester} onChange={(e) => setSelectedSemester(e.target.value)} disabled={!hasActiveAssignments}>
                            <option value="ALL">All Semesters</option>
                            {semesterOptionsForTeacher.map((semester) => (
                                <option key={semester} value={semester}>Semester {semester}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group module-filter">
                        <label>Filter Section</label>
                        <select value={selectedSection} onChange={(e) => setSelectedSection(e.target.value)} disabled={!hasActiveAssignments}>
                            <option value="ALL">All Sections</option>
                            {sectionOptionsForTeacher.map((section) => (
                                <option key={section} value={section}>Section {section}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group module-filter">
                        <label>{teacherMode === TEACHER_MODE.SUBJECT ? 'Subject' : 'Subject Scope'}</label>
                        <select
                            value={teacherMode === TEACHER_MODE.SUBJECT ? teacherSubject : homeRoomSubject}
                            onChange={(e) => {
                                if (teacherMode === TEACHER_MODE.SUBJECT) {
                                    setTeacherSubject(e.target.value);
                                } else {
                                    setHomeRoomSubject('ALL');
                                }
                            }}
                            disabled={!hasActiveAssignments || subjectOptionsForSelection.length === 0 || teacherMode === TEACHER_MODE.HOMEROOM}
                        >
                            {subjectOptionsForSelection.map((subject) => (
                                <option key={subject} value={subject}>{subject}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="module-panel attendance-table">
                    {filteredStudents.length === 0 && (
                        <div className="module-list-row" style={{ justifyContent: 'center', color: 'var(--color-gray)' }}>
                            No students found for this branch/semester/section selection.
                        </div>
                    )}
                    {filteredStudents.map(student => {
                        const rowCanMark = canMarkStudentForSubject(student, teacherSubject);
                        const homeroomSummary = homeroomAveragesByStudent[student.id];
                        return (
                            <div key={student.id} className="module-list-row attendance-row">
                                <div>
                                    <div style={{ fontWeight: 600 }}>{student.username || 'No Username'} ({student.email})</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>
                                        Sem {student.semester || '-'} | Sec {student.section || '-'} | ID: {student.id.split('-')[0]}
                                        {teacherMode === TEACHER_MODE.SUBJECT && !rowCanMark ? ' | View only for this subject' : ''}
                                    </div>
                                    {teacherMode === TEACHER_MODE.HOMEROOM && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
                                            {homeroomSummary ? homeroomSummary.subjectAverages.map((entry, idx) => (
                                                <div key={idx} style={{ 
                                                    padding: '0.2rem 0.5rem', 
                                                    border: '1px solid #333',
                                                    fontSize: '0.7rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.05em'
                                                }}>
                                                    <span style={{ color: '#888', marginRight: '0.4rem' }}>{entry.subject}</span>
                                                    <span style={{ color: '#fff', fontWeight: 600 }}>{entry.attendancePct}%</span>
                                                </div>
                                            )) : 'Subject averages are loading...'}
                                            {homeroomSummary && (
                                                <div style={{ 
                                                    padding: '0.2rem 0.5rem', 
                                                    border: '1px solid #fff',
                                                    fontSize: '0.7rem',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.05em',
                                                    background: '#fff',
                                                    color: '#000',
                                                    fontWeight: 'bold'
                                                }}>
                                                    Overall {homeroomSummary.overallAttendancePct}% ({homeroomSummary.overallPresentCount}/{homeroomSummary.overallTotalCount})
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {teacherMode === TEACHER_MODE.SUBJECT ? (
                                    <input
                                        type="checkbox"
                                        checked={!!selectedStudents[student.id]}
                                        onChange={() => handleCheckboxChange(student.id)}
                                        disabled={!rowCanMark}
                                        style={{ width: '24px', height: '24px', cursor: rowCanMark ? 'pointer' : 'not-allowed' }}
                                    />
                                ) : (
                                    <span className="attendance-homeroom-tag">Home Room</span>
                                )}
                            </div>
                        );
                    })}
                </div>
                {teacherMode === TEACHER_MODE.HOMEROOM && (homeroomAveragesQuery.data?.failedCount ?? 0) > 0 && (
                    <div className="module-message error" style={{ marginTop: '1rem' }}>
                        Unable to compute averages for {homeroomAveragesQuery.data.failedCount} students. Please retry the export after refresh.
                    </div>
                )}

                <div className="module-panel attendance-list-panel" style={{ marginTop: '1.2rem' }}>
                    <h2>{teacherMode === TEACHER_MODE.SUBJECT ? 'Export Subject Attendance' : 'Export Home Room Attendance'}</h2>
                    <p className="module-subtext" style={{ marginBottom: '1rem' }}>
                        Export filtered attendance for {selectedSection === 'ALL' ? 'all sections' : `Section ${selectedSection}`} with optional date range.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>From Date</label>
                            <input
                                type="text"
                                placeholder="YYYY-MM-DD"
                                value={exportFromDate}
                                onChange={(e) => setExportFromDate(e.target.value)}
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>To Date</label>
                            <input
                                type="text"
                                placeholder="YYYY-MM-DD"
                                value={exportToDate}
                                onChange={(e) => setExportToDate(e.target.value)}
                            />
                        </div>
                    </div>
                    {exportMessage.text && (
                        <div className={exportMessage.type === 'error' ? 'module-message error' : 'module-message success'} style={{ marginBottom: '1rem' }}>
                            {exportMessage.text}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="module-btn"
                            onClick={handleExportSectionExcel}
                            disabled={isExporting || filteredStudents.length === 0 || !hasActiveAssignments}
                        >
                            {isExporting ? 'Preparing...' : 'Export Excel'}
                        </button>
                        <button
                            type="button"
                            className="module-btn ghost"
                            onClick={handleExportSectionPdf}
                            disabled={isExporting || filteredStudents.length === 0 || !hasActiveAssignments}
                        >
                            {isExporting ? 'Preparing...' : 'Export PDF'}
                        </button>
                    </div>
                </div>

                {message && <div className={message.includes('Error') ? 'module-message error' : 'module-message success'}>{message}</div>}

                {teacherMode === TEACHER_MODE.SUBJECT && (
                    <button
                        onClick={saveAttendance}
                        disabled={saving || filteredStudents.length === 0 || !hasSubjectAssignments || !teacherSubject}
                        className="auth-submit"
                        style={{ marginTop: '1.2rem', maxWidth: '300px' }}
                    >
                        {saving ? 'Saving...' : 'Save Attendance'}
                    </button>
                )}
            </div>
        </div>
    );
}
