import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, googleProvider } from '../firebase';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';

const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in with Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* Background Image/Gradient */}
      <div 
        className="fixed inset-0 z-0 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #135bec 0%, #4a1d96 50%, #101622 100%)'
        }}
      >
        <div 
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            background: 'radial-gradient(circle at 20% 30%, rgba(19, 91, 236, 0.4) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(74, 29, 150, 0.4) 0%, transparent 50%)'
          }}
        />
        <img 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuAMNzqiue62LYyUuVTQ5_9rVnVC37kNWdTGMcTNn6xWcoPHad4hLnjSc5kDj6jm9JFzg2DUrDIMsuPULoFXLD7BnmcM9QrD8PitsV2z2Ofr9fjcQLTst-tlY1csYN2JJ154lDF6RX1gwi_i-Kn3ZKOPelEfEJO1Y4tngc2xnTeuFA6wtRHZxBCT6pUMRTumPXTEVe7HQcS97lrPaes9aK-JT6BPGCq2D4G-d41J2b0HAzqNeW7c6B9ytMPIA58B7_klQfsd14hYgBg" 
          alt="Background Texture"
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-overlay"
        />
      </div>

      <main className="relative z-10 w-full max-w-[360px] flex flex-col items-center animate-fade-in-up">
        <div className="mb-8 sm:mb-10 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-lg mb-2">Welcome Back</h1>
          <p className="text-sm text-white/60 font-medium">Access your investment dashboard</p>
        </div>

        <div className="bg-[#101622]/40 backdrop-blur-[25px] border border-white/10 w-full p-6 sm:p-8 rounded-2xl shadow-2xl transition-all duration-300 hover:bg-[#101622]/50 hover:border-white/20">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400">
              <Icon name="error_outline" className="text-lg shrink-0 mt-0.5" />
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-white/40 uppercase tracking-widest ml-1">Email Address</label>
              <input 
                autoFocus 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com" 
                className="w-full bg-white/5 border border-white/10 focus:bg-white/10 focus:border-primary focus:ring-2 focus:ring-primary/50 rounded-xl py-3 px-4 text-sm text-white placeholder-white/30 outline-none transition-all duration-200"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-white/40 uppercase tracking-widest ml-1">Password</label>
              <div className="relative group">
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" 
                  className="w-full bg-white/5 border border-white/10 focus:bg-white/10 focus:border-primary focus:ring-2 focus:ring-primary/50 rounded-xl py-3 px-4 text-sm text-white placeholder-white/30 outline-none transition-all duration-200 pr-12"
                />
                <button 
                  type="submit" 
                  disabled={loading}
                  aria-label="Sign in"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-primary/80 hover:bg-primary disabled:opacity-50 disabled:hover:bg-primary/80 active:scale-90 rounded-lg flex items-center justify-center transition-all shadow-lg"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Icon name="arrow_forward" outlined className="text-base text-white" />
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="mt-6 flex flex-col items-center w-full">
          <button className="text-xs font-medium text-white/50 hover:text-white transition-colors mb-6 sm:mb-8">
            Forgot Password?
          </button>
          
          <div className="w-full space-y-3">
            <button 
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full h-11 bg-white/5 hover:bg-white/10 disabled:opacity-50 active:scale-[0.98] border border-white/10 rounded-xl flex items-center justify-center gap-3 text-sm font-semibold text-white/90 transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 488 512" xmlns="http://www.w3.org/2000/svg">
                <path d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" fill="currentColor"></path>
              </svg>
              Sign in with Google
            </button>
          </div>
        </div>

        <Link to="/register" className="relative sm:absolute mt-12 sm:mt-0 sm:-bottom-24 flex flex-col items-center group cursor-pointer">
          <span className="text-[10px] font-bold text-white/30 mb-3 group-hover:text-white/60 transition-colors uppercase tracking-[0.2em]">
            Register Workspace
          </span>
          <div className="flex items-center justify-center w-9 h-9 rounded-full border border-white/10 bg-white/5 group-hover:bg-primary group-hover:border-primary group-hover:scale-110 active:scale-95 transition-all duration-300 shadow-sm">
            <Icon name="expand_more" outlined className="text-lg text-white/40 group-hover:text-white" />
          </div>
        </Link>
      </main>
    </div>
  );
};

export default LoginScreen;