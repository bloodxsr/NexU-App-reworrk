import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Header.css';

const WaveText = ({ text }) => {
    return (
        <span className="wave-text">
            {text.split('').map((char, index) => (
                <span key={index} style={{ transitionDelay: `${index * 30}ms` }}>
                    {char}
                </span>
            ))}
        </span>
    );
};

export default function Header() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
            <div className="header-logo">
                <Link to="/"><WaveText text="NEXU" /></Link>
            </div>
            <nav className="header-nav">
                <ul>
                    <li><Link to="/problem">The Problem</Link></li>
                    <li><Link to="/features">Core Features</Link></li>
                    <li><Link to="/tech">Tech Stack</Link></li>
                </ul>
            </nav>
        </header>
    );
}
