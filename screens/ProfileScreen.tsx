import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';

interface ProfileData {
  displayName: string;
  photoURL: string;
  jobTitle: string;
  dob: string;
  bio: string;
  gender: string;
  pronouns: string;
}

const ProfileScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ProfileData>({
    displayName: '',
    photoURL: '',
    jobTitle: '',
    dob: '',
    bio: '',
    gender: '',
    pronouns: '',
  });

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate('/login');
          return;
        }

        setFormData(prev => ({
          ...prev,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
        }));

        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const firestoreData = userDocSnap.data() as Partial<ProfileData>;
          setFormData(prev => ({
            ...prev,
            jobTitle: firestoreData.jobTitle || '',
            dob: firestoreData.dob || '',
            bio: firestoreData.bio || '',
            gender: firestoreData.gender || '', // Fetch gender
            pronouns: firestoreData.pronouns || '',
          }));
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError('Failed to load profile data');
        setLoading(false);
      }
    };

    fetchUserData();
  }, [navigate]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    setError(null);
  };

  const handleSaveChanges = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setError('You must be logged in');
        return;
      }

      setIsSaving(true);
      setError(null);

      await updateProfile(user, {
        displayName: formData.displayName,
        photoURL: formData.photoURL,
      });

      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(
        userDocRef,
        {
          displayName: formData.displayName,
          photoURL: formData.photoURL,
          jobTitle: formData.jobTitle,
          dob: formData.dob,
          bio: formData.bio,
          gender: formData.gender,
          pronouns: formData.pronouns,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setIsSaving(false);
      setShowSuccess(true);
      
      // Redirect to dashboard after a short delay to show success state
      setTimeout(() => {
        navigate('/dashboard');
      }, 150);

    } catch (err) {
      console.error('Error saving profile:', err);
      setError('Failed to save profile changes');
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
          <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-400">Loading profile...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-3xl mx-auto w-full">
          <div className="mb-8 animate-fade-in-up">
            <h1 className="text-3xl font-bold text-white mb-2">Profile Settings</h1>
            <p className="text-slate-400">Manage your account information and preferences</p>
          </div>

          {showSuccess && (
            <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-lg flex items-center gap-3 animate-fade-in-up">
              <Icon name="check_circle" className="text-emerald-500 text-lg" />
              <span className="text-sm font-medium text-emerald-200">Profile updated! Redirecting...</span>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3 animate-fade-in-up">
              <Icon name="error" className="text-red-500 text-lg" />
              <span className="text-sm font-medium text-red-200">{error}</span>
            </div>
          )}

          <div className="glass-panel rounded-xl p-6 md:p-8 animate-fade-in-up">
            <div className="mb-8 pb-8 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white mb-4">Profile Picture</h2>
              <div className="flex items-start gap-6">
                {formData.photoURL ? (
                  <img
                    src={formData.photoURL}
                    alt="Profile"
                    className="w-24 h-24 rounded-full border-2 border-slate-700 object-cover shadow-lg"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full border-2 border-slate-700 shadow-lg bg-primary/20 text-primary text-3xl font-bold flex items-center justify-center">
                    {(formData.displayName.trim()[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-200 mb-2">Profile Picture URL</label>
                  <input
                    type="url"
                    name="photoURL"
                    value={formData.photoURL}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </div>

            <div className="mb-8 pb-8 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white mb-6">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Full Name</label>
                  <input
                    type="text"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Job Title</label>
                  <input
                    type="text"
                    name="jobTitle"
                    value={formData.jobTitle}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Date of Birth</label>
                  <input
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  />
                </div>

                {/* GENDER SECTION */}
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Gender</label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  >
                    <option value="">Select Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Pronouns</label>
                  <input
                    type="text"
                    name="pronouns"
                    value={formData.pronouns}
                    onChange={handleInputChange}
                    placeholder="e.g. she/her, he/him, they/them"
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </div>

            <div className="mb-8">
              <h2 className="text-lg font-bold text-white mb-4">About You</h2>
              <textarea
                name="bio"
                value={formData.bio}
                onChange={handleInputChange}
                rows={4}
                className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-primary/50 resize-none"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-700">
              <button
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="flex-1 bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Icon name="save" className="text-sm" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>

              <button
                onClick={() => navigate('/dashboard')}
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-3 px-6 rounded-lg border border-white/10"
              >
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProfileScreen;