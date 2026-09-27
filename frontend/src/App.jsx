import { Suspense, lazy, useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';

import './App.css';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';


import ScrollCanvas from './components/ScrollCanvas';
import HomePage from './pages/HomePage';

const ProblemPage = lazy(() => import('./pages/ProblemPage'));
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'));
const TechPage = lazy(() => import('./pages/TechPage'));
const Auth = lazy(() => import('./pages/Auth'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const TeacherUpload = lazy(() => import('./pages/TeacherUpload'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Resources = lazy(() => import('./pages/Resources'));
const TeacherAttendance = lazy(() => import('./pages/TeacherAttendance'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AssignmentsScheduling = lazy(() => import('./pages/AssignmentsScheduling'));

gsap.registerPlugin(ScrollTrigger);

function App() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
      infinite: false,
    });

    // Expose Lenis globally for overlay control
    window.lenis = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const tickerCallback = (time) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(tickerCallback);

    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.destroy();
      gsap.ticker.remove(tickerCallback);
      window.lenis = undefined;
    };
  }, []);

  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}
import DefaultNav from './components/DefaultNav';
import { AnimatePresence, motion } from 'framer-motion';

function AppContent() {
  const { user, profile } = useAuth();
  const location = useLocation();

  return (
    <div className="app-container">
      <DefaultNav />
      <div className="app-content">
        <Suspense fallback={null}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<HomePage />} />
                <Route path="/problem" element={<ProblemPage />} />
                <Route path="/features" element={<FeaturesPage />} />
                <Route path="/tech" element={<TechPage />} />
                <Route path="/techstack" element={<Navigate to="/tech" replace />} />
                <Route path="/tech-stack" element={<Navigate to="/tech" replace />} />
                <Route path="/login" element={<Auth />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/teacher/upload" element={<TeacherUpload />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/teacher-attendance" element={<TeacherAttendance />} />
                <Route path="/resources" element={<Resources />} />
                <Route path="/timetable" element={<AssignmentsScheduling />} />
                <Route path="/admin" element={<AdminDashboard />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </div>
    </div>
  );
}

export default App;
