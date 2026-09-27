const SESSION_KEY = 'nexu_session_token';

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage;

const getSessionToken = () => (canUseStorage() ? window.localStorage.getItem(SESSION_KEY) : null);

const setSessionToken = (token) => {
  if (!canUseStorage()) return;
  if (!token) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, token);
};

const apiFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isBlobBody = typeof Blob !== 'undefined' && options.body instanceof Blob;
  if (hasBody && !isFormDataBody && !isBlobBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const sessionToken = getSessionToken();
  if (sessionToken) {
    headers.set('x-session-token', sessionToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  let payload = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = {};
      }
    }
  } catch {
    payload = {};
    rawText = '';
  }

  if (!res.ok) {
    throw new Error(payload?.error || rawText || `Request failed (${res.status})`);
  }

  return payload;
};

export const authApi = {
  async getSession() {
    const data = await apiFetch('/api/auth/session', { method: 'GET' });
    return { session: data.session ?? null };
  },

  async signUp({ email, username, password, role }) {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, username, password, role }),
    });

    const token = data?.session?.token;
    if (token !== undefined && token !== null && token !== '') {
      setSessionToken(token);
    }
    if (data.session && data.user) {
      data.session.user = data.user;
    }
    return data;
  },

  async signInWithPassword({ identifier, password }) {
    const data = await apiFetch('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });

    const token = data?.session?.token;
    if (token !== undefined && token !== null && token !== '') {
      setSessionToken(token);
    }
    if (data.session && data.user) {
      data.session.user = data.user;
    }
    return data;
  },

  async signOut() {
    try {
      await apiFetch('/api/auth/signout', { method: 'POST', body: JSON.stringify({}) });
    } finally {
      setSessionToken(null);
    }
    return { error: null };
  },
};

export const profileApi = {
  async getById(userId) {
    const data = await apiFetch(`/api/profiles/${encodeURIComponent(userId)}`, { method: 'GET' });
    return data.data ?? null;
  },

  async listStudents(fieldOfStudy = 'ALL', searchTerm = '') {
    const qs = new URLSearchParams();
    if (fieldOfStudy) qs.set('field', fieldOfStudy);
    const q = String(searchTerm || '').trim();
    if (q) qs.set('q', q);
    const data = await apiFetch(`/api/profiles/students?${qs.toString()}`, { method: 'GET' });
    return data.data ?? [];
  },

  async listAll() {
    const data = await apiFetch('/api/profiles', { method: 'GET' });
    return data.data ?? [];
  },

  async updateMeta(userId, payload) {
    await apiFetch(`/api/profiles/${encodeURIComponent(userId)}/meta`, { method: 'POST', body: JSON.stringify(payload) });
  },

  async linkRfid(userId, rfidUid) {
    await apiFetch(`/api/profiles/${encodeURIComponent(userId)}/rfid`, { method: 'POST', body: JSON.stringify({ rfid_uid: rfidUid }) });
  },

  async getMyTeacherAccess() {
    const data = await apiFetch('/api/profiles/teacher/access', { method: 'GET' });
    return data.data ?? { teacher_id: null, subject_access: [], home_classes: [], allowed_classes: [] };
  },

  async getTeacherAccessForAdmin(teacherId) {
    const data = await apiFetch(`/api/admin/teacher-access/${encodeURIComponent(teacherId)}`, { method: 'GET' });
    return data.data ?? { teacher_id: teacherId, subject_access: [], home_classes: [], allowed_classes: [] };
  },

  async addTeacherSubjectAccess(teacherId, payload) {
    await apiFetch(`/api/admin/teacher-access/${encodeURIComponent(teacherId)}/subject`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async removeTeacherSubjectAccess(teacherId, payload) {
    await apiFetch(`/api/admin/teacher-access/${encodeURIComponent(teacherId)}/subject/remove`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async assignHomeClass(teacherId, payload) {
    await apiFetch(`/api/admin/teacher-access/${encodeURIComponent(teacherId)}/home`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async removeHomeClass(teacherId, payload) {
    await apiFetch(`/api/admin/teacher-access/${encodeURIComponent(teacherId)}/home/remove`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async uploadStudentWhitelist(csvText) {
    await apiFetch('/api/admin/whitelist/students', {
      method: 'POST',
      body: csvText,
      headers: { 'Content-Type': 'text/csv' },
    });
  },

  async uploadTeacherWhitelist(csvText) {
    await apiFetch('/api/admin/whitelist/teachers', {
      method: 'POST',
      body: csvText,
      headers: { 'Content-Type': 'text/csv' },
    });
  },
};

export const teacherAttendanceApi = {
  async listForTeacher(teacherId) {
    const data = await apiFetch(`/api/teacher_attendance/${encodeURIComponent(teacherId)}`, { method: 'GET' });
    return data.data ?? [];
  },

  async updateAttendance(date, status) {
    await apiFetch('/api/teacher_attendance/update', {
      method: 'POST',
      body: JSON.stringify({ date, status }),
    });
  },
};

export const attendanceApi = {
  async listForStudent(studentId, subject = 'ALL') {
    const qs = new URLSearchParams();
    if (subject) qs.set('subject', subject);
    const data = await apiFetch(
      `/api/attendance/student/${encodeURIComponent(studentId)}?${qs.toString()}`,
      { method: 'GET' }
    );
    return data.data ?? [];
  },

  async upsertMany(records) {
    await apiFetch('/api/attendance/upsert', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  },
};

export const resourceApi = {
  async listByAudience(fieldOfStudy, semester, section, searchTerm = '') {
    const qs = new URLSearchParams({ field: fieldOfStudy, semester, section });
    const q = String(searchTerm || '').trim();
    if (q) qs.set('q', q);
    const data = await apiFetch(`/api/resources?${qs.toString()}`, { method: 'GET' });
    return data.data ?? [];
  },

  async uploadPdf(file) {
    const sessionToken = getSessionToken();
    if (!sessionToken) {
      throw new Error('Session expired. Please sign in again.');
    }
    const fileName = typeof file?.name === 'string' ? file.name : 'resource.pdf';
    const qs = new URLSearchParams({ name: fileName });
    const headers = new Headers();
    headers.set('Content-Type', file?.type || 'application/octet-stream');
    headers.set('x-session-token', sessionToken);

    const res = await fetch(`/api/uploads/resources?${qs.toString()}`, {
      method: 'PUT',
      headers,
      body: file,
    });

    let payload = {};
    let rawText = '';
    try {
      rawText = await res.text();
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = {};
        }
      }
    } catch {
      payload = {};
      rawText = '';
    }

    if (!res.ok) {
      console.error('Upload API failed', {
        status: res.status,
        statusText: res.statusText,
        payload,
        rawText,
      });
      throw new Error(payload?.error || rawText || `Upload failed (${res.status})`);
    }

    return payload.file_url;
  },

  async create(resource) {
    await apiFetch('/api/resources', {
      method: 'POST',
      body: JSON.stringify(resource),
    });
  },
};

export const submissionApi = {
  async create(submission) {
    await apiFetch('/api/submissions', {
      method: 'POST',
      body: JSON.stringify(submission),
    });
  },
};

export const assignmentApi = {
  async listByClass(field_of_study, semester, section) {
    const qs = new URLSearchParams({ field_of_study, semester, section });
    const data = await apiFetch(`/api/assignments?${qs.toString()}`, { method: 'GET' });
    return data.data ?? [];
  },

  async create(payload) {
    await apiFetch('/api/assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const scheduleApi = {
  async listByClass(field_of_study, semester, section) {
    const qs = new URLSearchParams({ field_of_study, semester, section });
    const data = await apiFetch(`/api/schedule?${qs.toString()}`, { method: 'GET' });
    return data.data ?? [];
  },

  async create(payload) {
    await apiFetch('/api/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async remove(id, field_of_study, semester, section) {
    const qs = new URLSearchParams({ field_of_study, semester, section });
    await apiFetch(`/api/schedule/${encodeURIComponent(id)}?${qs.toString()}`, {
      method: 'DELETE',
    });
  },
};

export const channelApi = {
  async listChannels() {
    const data = await apiFetch('/api/channels', { method: 'GET' });
    return data.data ?? [];
  },

  async listMessages(channelId) {
    const data = await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/messages`, { method: 'GET' });
    return data.data ?? [];
  },

  async postMessage(channelId, payload) {
    await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const notificationsApi = {
  async list() {
    const data = await apiFetch('/api/notifications', { method: 'GET' });
    return data.data ?? [];
  },

  async create(title, body, file_url) {
    const data = await apiFetch('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({ title, body, file_url })
    });
    return data;
  }
};
