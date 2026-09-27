import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import './Auth.css';

export default function Auth() {
    const [isLogin, setIsLogin] = useState(true);
    const [identifier, setIdentifier] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [role, setRole] = useState('student');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { signIn, signUp } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let authResult;
            if (isLogin) {
                authResult = await signIn(identifier, password);
            } else {
                authResult = await signUp(
                    email,
                    username,
                    password,
                    role
                );
            }

            if (authResult?.session) {
                navigate('/dashboard');
            } else {
                setError('Account created. Please verify your email, then log in.');
            }
        } catch (err) {
            setError(err.message || 'An error occurred during authentication');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <h1>{isLogin ? 'Welcome Back' : 'Join Nexu'}</h1>
                        <p>{isLogin ? 'Login to your account' : 'Create your student or teacher profile'}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="auth-form">
                        {isLogin ? (
                            <div className="form-group">
                                <label>Username or Email</label>
                                <input
                                    type="text"
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    required
                                    placeholder="username or name@example.com"
                                />
                            </div>
                        ) : (
                            <>
                                <div className="form-group">
                                    <label>Username</label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required
                                        placeholder="your_username"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Email Address</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        placeholder="name@example.com"
                                    />
                                </div>
                            </>
                        )}

                        <div className="form-group">
                            <label>Password</label>
                            <div className="password-field">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    placeholder="........"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {!isLogin && (
                            <>
                                <div className="form-group">
                                    <label>I am a...</label>
                                    <div className="role-selector">
                                        <button
                                            type="button"
                                            className={role === 'student' ? 'active' : ''}
                                            onClick={() => setRole('student')}
                                        >
                                            Student
                                        </button>
                                        <button
                                            type="button"
                                            className={role === 'teacher' ? 'active' : ''}
                                            onClick={() => setRole('teacher')}
                                        >
                                            Teacher
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {error && <div className="auth-error">{error}</div>}

                        <button type="submit" className="auth-submit" disabled={loading}>
                            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                        </button>
                    </form>

                    <div className="auth-footer">
                        <button onClick={() => setIsLogin(!isLogin)} className="toggle-auth">
                            {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
