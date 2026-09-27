import { useCallback, useEffect, useMemo, useState } from 'react';
import { authApi, profileApi } from '../lib/localBase';
import { AuthContext } from './AuthContextInstance';

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileError, setProfileError] = useState('');

    const fetchProfile = useCallback(async (userId) => {
        try {
            const data = await profileApi.getById(userId);
            if (!data) {
                setProfile(null);
                setProfileError('Profile not found');
                return;
            }
            setProfile(data);
            setProfileError('');
        } catch (err) {
            setProfile(null);
            setProfileError(err?.message || 'Unexpected error fetching profile');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;

        const init = async () => {
            setLoading(true);
            try {
                const { session: initialSession } = await authApi.getSession();
                if (!active) return;

                setSession(initialSession);

                if (active && initialSession?.user) {
                    await fetchProfile(initialSession.user.id);
                } else if (active) {
                    setProfile(null);
                    setProfileError('');
                }
            } catch (err) {
                console.error('Failed to initialize auth session:', err);
                if (active) {
                    setSession(null);
                    setProfile(null);
                    setProfileError(err?.message || 'Unexpected error initializing session');
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        init();

        return () => {
            active = false;
        };
    }, [fetchProfile]);

    const signUp = useCallback(async (email, username, password, role, fieldOfStudy, semester, section) => {
        setLoading(true);
        setProfileError('');
        try {
            const data = await authApi.signUp({ email, username, password, role, fieldOfStudy, semester, section });
            setSession(data.session ?? null);
            if (data.user) {
                await fetchProfile(data.user.id);
            } else {
                setLoading(false);
            }
            return data;
        } catch (err) {
            setLoading(false);
            throw err;
        }
    }, [fetchProfile]);

    const signIn = useCallback(async (identifier, password) => {
        setLoading(true);
        setProfileError('');
        try {
            const data = await authApi.signInWithPassword({ identifier, password });
            setSession(data.session ?? null);
            if (data.user) {
                await fetchProfile(data.user.id);
            } else {
                setLoading(false);
            }
            return data;
        } catch (err) {
            setLoading(false);
            throw err;
        }
    }, [fetchProfile]);

    const signOut = useCallback(async () => {
        try {
            await authApi.signOut();
        } finally {
            setSession(null);
            setProfile(null);
            setProfileError('');
            setLoading(false);
        }
    }, []);

    const value = useMemo(() => ({
        session,
        user: session?.user ?? null,
        profile,
        profileError,
        loading,
        signUp,
        signIn,
        signOut,
        isTeacher: profile?.role === 'teacher',
        isStudent: profile?.role === 'student',
        isAdmin: profile?.role === 'admin',
    }), [session, profile, profileError, loading, signUp, signIn, signOut]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
