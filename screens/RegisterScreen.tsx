import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { auth, googleProvider } from '../firebase';
import { createUserWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';

const RegisterScreen: React.FC = () => {
  const navigate = useNavigate();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Update the user's profile with their name
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName: name });
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to create an account.');
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
    <div className="bg-mesh min-h-screen flex items-center justify-center font-display overflow-y-auto py-8 px-4 sm:px-6">
      <main className="relative z-10 w-full max-w-[420px] animate-fade-in-up">
        <div className="mac-glass rounded-3xl p-6 sm:p-8 flex flex-col items-center transition-all duration-300 hover:border-white/20">
          
          <div className="mb-6 sm:mb-8 hover:scale-105 transition-transform duration-300">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-2xl">
              <Icon name="hub" className="text-white text-2xl sm:text-3xl" />
            </div>
          </div>
          
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-white text-xl sm:text-2xl font-bold tracking-tight">Create Account</h1>
            <p className="text-slate-400 text-sm mt-1">Join the venture capital network</p>
          </div>

          {error && (
            <div className="w-full mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400">
              <Icon name="error_outline" className="text-lg shrink-0 mt-0.5" />
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleRegister} className="w-full space-y-4">
            <div className="space-y-1.5 group">
              <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase tracking-widest group-focus-within:text-primary transition-colors">Full Name</label>
              <div className="relative">
                <Icon name="person" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg group-focus-within:text-primary transition-colors" />
                <input 
                  type="text" 
                  required 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe" 
                  className="mac-input w-full rounded-xl py-3 pl-11 pr-4 text-white placeholder-slate-600 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5 group">
              <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase tracking-widest group-focus-within:text-primary transition-colors">Email Address</label>
              <div className="relative">
                <Icon name="alternate_email" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg group-focus-within:text-primary transition-colors" />
                <input 
                  type="email" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com" 
                  className="mac-input w-full rounded-xl py-3 pl-11 pr-4 text-white placeholder-slate-600 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5 group">
              <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase tracking-widest group-focus-within:text-primary transition-colors">Password</label>
              <div className="relative">
                <Icon name="lock" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-lg group-focus-within:text-primary transition-colors" />
                <input 
                  type={showPassword ? "text" : "password"}
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" 
                  className="mac-input w-full rounded-xl py-3 pl-11 pr-12 text-white placeholder-slate-600 text-sm"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility" 
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white active:scale-90 transition-all"
                >
                  <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-lg" />
                </button>
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center bg-primary hover:bg-primary/90 text-white font-semibold py-3.5 rounded-xl mt-6 transition-all duration-300 shadow-lg shadow-primary/20 disabled:opacity-50 disabled:hover:bg-primary active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[#101622]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Continue'
              )}
            </button>
          </form>

          <div className="flex items-center w-full my-6 opacity-20">
            <div className="h-[1px] flex-1 bg-white"></div>
          </div>

          <div className="w-full">
            <button 
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 active:scale-[0.98] transition-all"
            >
              <svg className="w-4 h-4" viewBox="0 0 488 512" xmlns="http://www.w3.org/2000/svg">
                <path d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" fill="currentColor"></path>
              </svg>
              <span className="text-xs text-white font-medium">Sign in with Google</span>
            </button>
          </div>

        </div>

        <div className="mt-8 flex justify-center">
          <Link to="/login" className="flex items-center space-x-3 group text-slate-400 hover:text-white transition-all duration-300">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 group-hover:bg-white/10 border border-white/10 group-active:scale-95 transition-all">
              <Icon name="arrow_back" className="text-xl" />
            </div>
            <span className="text-sm font-medium">Back to Login</span>
          </Link>
        </div>
      </main>
    </div>
  );
};

export default RegisterScreen;