import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './PageTransition.css';

export default function PageTransition({ children }) {
    const location = useLocation();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
        setTimeout(() => setLoading(true), 0);
        const timer = setTimeout(() => setLoading(false), 1300);
        return () => clearTimeout(timer);
    }, [location.pathname]);

    return (
        <>
            {loading && (
                <div className="page-preloader">
                    <span className="page-preloader-text">NEXU</span>
                </div>
            )}
            {children}
        </>
    );
}
