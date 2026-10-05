import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import "./App.css";

// Task log dataset
const TASKS_DATA = [
  { id: 1, type: "completed", text: "Marketing Campaign" },
  { id: 2, type: "completed", text: "New webpage" },
  { id: 3, type: "running", text: "bug fix" },
  { id: 4, type: "completed", text: "SEO Optimization" },
  { id: 5, type: "completed", text: "Social media post" },
  { id: 6, type: "running", text: "AI training loop" },
  { id: 7, type: "completed", text: "Database migration" },
];

export default function App() {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState("Start");
  
  // Parallax background coordinate state
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Floating tasks queue
  const [visibleTasks, setVisibleTasks] = useState([
    { id: 1, type: "completed", text: "Marketing Campaign" },
    { id: 2, type: "completed", text: "New webpage" },
    { id: 3, type: "running", text: "bug fix" },
  ]);

  // Handle background parallax movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const x = (clientX / window.innerWidth - 0.5) * 15; // Max 15px shift
      const y = (clientY / window.innerHeight - 0.5) * 15;
      setMousePos({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Simulate incoming tasks
  useEffect(() => {
    let taskIdx = 3;
    const interval = setInterval(() => {
      taskIdx = (taskIdx + 1) % TASKS_DATA.length;
      const nextTask = TASKS_DATA[taskIdx];
      
      setVisibleTasks((prev) => {
        // Remove the oldest task and add the new one
        const updated = [...prev.slice(1), { ...nextTask, id: Date.now() }];
        return updated;
      });
    }, 4000); // Shift tasks every 4 seconds

    return () => clearInterval(interval);
  }, []);

  const tabs = ["How to", "Start", "Build", "Sell", "Scale"];

  return (
    <div className="app-container">
      {/* Background with Parallax */}
      <div 
        className="bg-wrapper"
        style={{
          transform: `scale(1.03) translate(${mousePos.x}px, ${mousePos.y}px)`
        }}
      />
      <div className="bg-gradient-overlay" />

      {/* Clouds Drifting Overlay (Pixelated clouds) */}
      <div className="clouds-container">
        <div 
          className="cloud-drifter" 
          style={{ 
            top: "10%", 
            animationDuration: "120s", 
            width: "150px", 
            height: "80px",
            background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)"
          }} 
        />
        <div 
          className="cloud-drifter" 
          style={{ 
            top: "25%", 
            animationDuration: "180s", 
            animationDelay: "-30s",
            width: "200px", 
            height: "100px",
            background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)"
          }} 
        />
      </div>

      <div className="content-wrapper">
        {/* Navigation Bar */}
        <header className="nav-header">
          <a href="#" className="nav-logo">
            Cofounder
          </a>

          {/* Sliding Glass Tabs Switcher */}
          <div className="nav-tabs-container glass">
            {tabs.map((tab, idx) => (
              <div key={tab} className="flex items-center">
                {idx > 0 && <div className="nav-tab-divider" />}
                <button
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className="nav-tab-btn"
                  style={{
                    color: activeTab === tab ? "#ffffff" : "rgba(255,255,255,0.6)"
                  }}
                >
                  {activeTab === tab && (
                    <motion.div
                      layoutId="active-nav-tab"
                      className="absolute inset-0 bg-white/10 rounded-full"
                      transition={{ type: "spring", stiffness: 350, damping: 28 }}
                    />
                  )}
                  {tab}
                </button>
              </div>
            ))}
          </div>

          {/* Right Action Menu */}
          <div className="nav-actions">
            <button className="action-btn-pill glass-btn">Resources</button>
            <button className="action-btn-text">Pricing</button>
            <button className="action-btn-text">Log in</button>
            <button className="action-btn-pill solid-white">Run a company</button>
          </div>
        </header>

        {/* Hero Section */}
        <main className="hero-section">
          <div className="hero-text-container">
            <motion.h1 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="hero-headline"
            >
              Cofounder lets you run an <br />
              entire company with AI
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="hero-subtitle"
            >
              Run engineering, sales, marketing, design, finance, and ops.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="hero-buttons"
            >
              <button className="hero-btn primary">Run a company</button>
              <button className="hero-btn secondary">Check out the launch</button>
            </motion.div>
          </div>
        </main>

        {/* Floating task status panel (aligned above laptop background) */}
        <div className="right-sidebar">
          <AnimatePresence mode="popLayout">
            {visibleTasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 0.9, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -15, scale: 0.95 }}
                layout
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 30
                }}
                className="task-bubble glass-dark"
              >
                <div className={`status-dot ${task.type}`} />
                <div className="text-left">
                  <div className="task-label">
                    Task {task.type === "completed" ? "Completed" : "running"}
                  </div>
                  <div className="task-desc">{task.text}</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Far-right floating Asterisk badge */}
        <div className="asterisk-btn-container">
          <button className="asterisk-btn">
            <Sparkles className="asterisk-icon size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
