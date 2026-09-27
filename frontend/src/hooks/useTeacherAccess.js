import { useState, useEffect } from 'react';
import { profileApi } from '../lib/localBase';

export function useTeacherAccess(user, isTeacher) {
    const [teacherAccess, setTeacherAccess] = useState(null);
    const [teacherAccessLoading, setTeacherAccessLoading] = useState(false);
    const [teacherAccessError, setTeacherAccessError] = useState('');

    useEffect(() => {
        let active = true;
        if (user && isTeacher) {
            queueMicrotask(() => {
                if (active) {
                    setTeacherAccessLoading(true);
                    setTeacherAccessError('');
                }
            });
            profileApi.getMyTeacherAccess()
                .then(data => {
                    if (active) setTeacherAccess(data);
                })
                .catch(err => {
                    if (active) {
                        setTeacherAccess(null);
                        setTeacherAccessError(err?.message || 'Failed to load access summary');
                    }
                })
                .finally(() => {
                    if (active) setTeacherAccessLoading(false);
                });
        }
        return () => { active = false; };
    }, [user, isTeacher]);

    return { teacherAccess, teacherAccessLoading, teacherAccessError };
}
