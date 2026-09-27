import { useAuth } from '../context/useAuth';
import './CardNav.css';
import React, { useState, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoArrowUpRight } from 'react-icons/go';
import gsap from 'gsap';
const CardNav = ({
    items,
    className = '',
    ease = 'power3.out',
    baseColor = '#fff',
    menuColor,
    buttonBgColor,
    buttonTextColor,
    variant = 'dark',
    isInternalPage
}) => {
    const { user, profile, signOut } = useAuth();
    const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const navRef = useRef(null);
    const cardsRef = useRef([]);
    const tlRef = useRef(null);
    const navigate = useNavigate();

    const calculateHeight = () => {
        const navEl = navRef.current;
        if (!navEl) return 160;

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            const contentEl = navEl.querySelector('.card-nav-content');
            if (contentEl) {
                const wasVisibility = contentEl.style.visibility;
                const wasPointerEvents = contentEl.style.pointerEvents;
                const wasPosition = contentEl.style.position;
                const wasHeight = contentEl.style.height;

                contentEl.style.visibility = 'visible';
                contentEl.style.pointerEvents = 'auto';
                contentEl.style.position = 'static';
                contentEl.style.height = 'auto';
                contentEl.offsetHeight;

                const topBar = 60;
                const padding = 16;
                const contentHeight = contentEl.scrollHeight;

                contentEl.style.visibility = wasVisibility;
                contentEl.style.pointerEvents = wasPointerEvents;
                contentEl.style.position = wasPosition;
                contentEl.style.height = wasHeight;

                return topBar + contentHeight + padding;
            }
        }
        return 160;
    };

    const createTimeline = () => {
        const navEl = navRef.current;
        if (!navEl) return null;
        const cardTargets = cardsRef.current.filter(Boolean);

        gsap.set(navEl, { height: 60, overflow: 'hidden' });
        if (cardTargets.length > 0) {
            gsap.set(cardTargets, { y: 50, opacity: 0 });
        }

        const tl = gsap.timeline({ paused: true });
        tl.to(navEl, { height: calculateHeight, duration: 0.4, ease });
        if (cardTargets.length > 0) {
            tl.to(
                cardTargets,
                { y: 0, opacity: 1, duration: 0.4, ease, stagger: 0.08 },
                '-=0.1'
            );
        }

        return tl;
    };

    useLayoutEffect(() => {
        const tl = createTimeline();
        tlRef.current = tl;
        return () => { tl?.kill(); tlRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ease, items]);

    useLayoutEffect(() => {
        const handleResize = () => {
            if (!tlRef.current) return;
            if (isExpanded) {
                const newHeight = calculateHeight();
                gsap.set(navRef.current, { height: newHeight });
                tlRef.current.kill();
                const newTl = createTimeline();
                if (newTl) { newTl.progress(1); tlRef.current = newTl; }
            } else {
                tlRef.current.kill();
                const newTl = createTimeline();
                if (newTl) tlRef.current = newTl;
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExpanded]);

    const toggleMenu = () => {
        const tl = tlRef.current;
        if (!tl) return;
        if (!isExpanded) {
            setIsHamburgerOpen(true);
            setIsExpanded(true);
            tl.play(0);
        } else {
            setIsHamburgerOpen(false);
            tl.eventCallback('onReverseComplete', () => setIsExpanded(false));
            tl.reverse();
        }
    };

    const handleLinkClick = (href) => {
        if (href) {
            // Close menu first, then navigate
            setIsHamburgerOpen(false);
            const tl = tlRef.current;
            if (tl && isExpanded) {
                tl.eventCallback('onReverseComplete', () => {
                    setIsExpanded(false);
                    navigate(href);
                });
                tl.reverse();
            } else {
                navigate(href);
            }
        }
    };

    const handleLogout = async () => {
        setIsHamburgerOpen(false);
        setIsExpanded(false);

        try {
            await Promise.race([
                signOut(),
                new Promise((resolve) => setTimeout(resolve, 5000)),
            ]);
        } finally {
            navigate('/login', { replace: true });
        }
    };

    const setCardRef = i => el => {
        cardsRef.current[i] = el;
    };

    return (
        <div className={`card-nav-container ${className}`}>
            <nav
                ref={navRef}
                className={`card-nav ${variant === 'white' ? 'card-nav--white' : (variant === 'solid' ? 'card-nav--solid' : 'card-nav--dark')} ${isExpanded ? 'open' : ''}`}
            >
                <div className="card-nav-top">
                    <div
                        className={`hamburger-menu ${isHamburgerOpen ? 'open' : ''}`}
                        onClick={toggleMenu}
                        role="button"
                        aria-label={isExpanded ? 'Close menu' : 'Open menu'}
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleMenu();
                            }
                        }}
                        style={{ color: menuColor || '#000' }}
                    >
                        <div className="hamburger-line" />
                        <div className="hamburger-line" />
                    </div>

                    <div className="logo-container" onClick={() => handleLinkClick('/')}>
                        <span className="card-nav-logo-text" style={{ color: menuColor || '#fff' }}>NEXU</span>
                        <span className="card-nav-logo-subtext">Campus OS</span>
                    </div>

                    {!user ? (
                        <button
                            type="button"
                            className="card-nav-cta-button"
                            style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
                            onClick={() => handleLinkClick('/login')}
                        >
                            Get Started
                        </button>
                    ) : (
                        <div className="auth-nav-group">
                            {!isInternalPage ? (
                                <button
                                    type="button"
                                    className="card-nav-cta-button"
                                    style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
                                    onClick={() => handleLinkClick('/dashboard')}
                                >
                                    Dashboard
                                </button>
                            ) : (
                                <>
                                    <span className="user-role-badge">{profile?.role}</span>
                                    <button
                                        type="button"
                                        className="card-nav-cta-button logout-button"
                                        style={{ backgroundColor: '#ffffff', color: '#000000', border: '1px solid #333' }}
                                        onClick={handleLogout}
                                    >
                                        Logout
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="card-nav-content" aria-hidden={!isExpanded}>
                    {(items || []).slice(0, 3).map((item, idx) => (
                        <div
                            key={`${item.label}-${idx}`}
                            className="nav-card"
                            ref={setCardRef(idx)}
                            style={{ backgroundColor: item.bgColor, color: item.textColor }}
                        >
                            <div className="nav-card-label">{item.label}</div>
                            <div className="nav-card-links">
                                {item.links?.map((lnk, i) => (
                                    <button
                                        key={`${lnk.label}-${i}`}
                                        className="nav-card-link"
                                        onClick={() => handleLinkClick(lnk.href)}
                                        aria-label={lnk.ariaLabel}
                                        style={{ color: item.textColor }}
                                    >
                                        <GoArrowUpRight className="nav-card-link-icon" aria-hidden="true" />
                                        {lnk.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </nav>
        </div>
    );
};

export default CardNav;
