import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export default function DefaultNav() {
    const { user, profile, signOut } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut();
        navigate('/');
    };

    return (
        <nav style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.5rem 3rem',
            background: '#000',
            borderBottom: '1px solid #333',
            color: '#fff'
        }}>
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                <Link to="/" style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '0.1em' }}>NEXU</Link>
                {!user && (
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                        <Link to="/problem" style={{ color: '#ccc' }}>The Problem</Link>
                        <Link to="/features" style={{ color: '#ccc' }}>Features</Link>
                        <Link to="/tech" style={{ color: '#ccc' }}>Tech Stack</Link>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                {!user ? (
                    <Link to="/login" className="nav-btn">Login</Link>
                ) : (
                    <>
                        <Link to="/dashboard" style={{ color: '#ccc' }}>Dashboard</Link>
                        {profile?.role === 'teacher' ? (
                            <>
                                <Link to="/attendance" style={{ color: '#ccc' }}>Mark Attendance</Link>
                                <Link to="/teacher-attendance" style={{ color: '#ccc' }}>My Attendance</Link>
                                <Link to="/teacher/upload" style={{ color: '#ccc' }}>Upload</Link>
                            </>
                        ) : profile?.role === 'admin' ? (
                            <Link to="/admin" style={{ color: '#ccc' }}>Admin Portal</Link>
                        ) : (
                            <>
                                <Link to="/attendance" style={{ color: '#ccc' }}>Attendance</Link>
                                <Link to="/resources" style={{ color: '#ccc' }}>Resources</Link>
                            </>
                        )}

                        <button onClick={handleLogout} className="nav-btn">Logout</button>
                    </>
                )}
            </div>
        </nav>
    );
}
