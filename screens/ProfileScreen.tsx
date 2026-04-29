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
  });

  // Fetch user data on component mount
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate('/login');
          return;
        }

        // Set auth-provided data
        setFormData(prev => ({
          ...prev,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
        }));

        // Fetch additional data from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const firestoreData = userDocSnap.data() as Partial<ProfileData>;
          setFormData(prev => ({
            ...prev,
            jobTitle: firestoreData.jobTitle || '',
            dob: firestoreData.dob || '',
            bio: firestoreData.bio || '',
            gender: firestoreData.gender || '',
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
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    setError(null); // Clear error when user starts typing
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

      // Update Firebase Auth profile
      await updateProfile(user, {
        displayName: formData.displayName,
        photoURL: formData.photoURL,
      });

      // Save additional data to Firestore
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
          updatedAt: new Date(),
        },
        { merge: true }
      );

      setIsSaving(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
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
          {/* Page Title */}
          <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '0ms', animationFillMode: 'both' }}>
            <h1 className="text-3xl font-bold text-white mb-2">Profile Settings</h1>
            <p className="text-slate-400">Manage your account information and preferences</p>
          </div>

          {/* Success Toast */}
          {showSuccess && (
            <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-500/50 rounded-lg flex items-center gap-3 animate-fade-in-up">
              <Icon name="check_circle" className="text-emerald-500 text-lg" />
              <span className="text-sm font-medium text-emerald-200">Profile updated successfully!</span>
            </div>
          )}

          {/* Error Toast */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3 animate-fade-in-up">
              <Icon name="error" className="text-red-500 text-lg" />
              <span className="text-sm font-medium text-red-200">{error}</span>
            </div>
          )}

          {/* Profile Form */}
          <div
            className="glass-panel rounded-xl p-6 md:p-8 animate-fade-in-up"
            style={{ animationDelay: '100ms', animationFillMode: 'both' }}
          >
            {/* Profile Picture Section */}
            <div className="mb-8 pb-8 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white mb-4">Profile Picture</h2>
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0">
                  <img
                    src={
                      formData.photoURL ||
                      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop'
                    }
                    alt="Profile"
                    className="w-24 h-24 rounded-full border-2 border-slate-700 object-cover shadow-lg"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Profile Picture URL
                  </label>
                  <input
                    type="url"
                    name="photoURL"
                    value={formData.photoURL}
                    onChange={handleInputChange}
                    placeholder="https://example.com/image.jpg"
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Paste the URL of your profile picture
                  </p>
                </div>
              </div>
            </div>

            {/* Personal Information Section */}
            <div className="mb-8 pb-8 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white mb-6">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Full Name <span className="text-primary">*</span>
                  </label>
                  <input
                    type="text"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    placeholder="John Doe"
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>

                {/* Job Title */}
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Job Title <span className="text-primary">*</span>
                  </label>
                  <input
                    type="text"
                    name="jobTitle"
                    value={formData.jobTitle}
                    onChange={handleInputChange}
                    placeholder="General Partner"
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>

                {/* Date of Birth */}
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>

                {/* Gender */}
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Gender
                  </label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  >
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-binary">Non-binary</option>
                    <option value="prefer-not-to-say">Prefer not to say</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Bio Section */}
            <div className="mb-8">
              <h2 className="text-lg font-bold text-white mb-4">About You</h2>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Bio
              </label>
              <textarea
                name="bio"
                value={formData.bio}
                onChange={handleInputChange}
                placeholder="Tell us about yourself..."
                rows={4}
                className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg px-4 py-2.5 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all outline-none resize-none"
              />
              <p className="text-xs text-slate-500 mt-2">
                {formData.bio.length}/500 characters
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-slate-700">
              <button
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="flex-1 bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
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
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10"
              >
                <Icon name="close" className="text-sm" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Decorative Background Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default ProfileScreen;
