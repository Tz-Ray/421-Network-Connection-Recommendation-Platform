import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
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

import { useShell } from '../components/AppShell';
import { setTheme, useTheme, type Theme } from '../lib/theme';
import { isGraphMember } from '../lib/networkGraph';
import '../styles/profile.css';

const ProfileScreen: React.FC = () => {
  const navigate = useNavigate();
  const shell = useShell();
  const theme = useTheme();
  const [sharing, setSharing] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
    if (uid)
      void isGraphMember(uid)
        .then((v) => {
          if (active) setSharing(v);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState<ProfileData | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProfileData, string>>>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const saveAttempt = useRef(0);
  const today = new Date().toLocaleDateString('en-CA');
  const [formData, setFormData] = useState<ProfileData>({
    displayName: '',
    photoURL: '',
    jobTitle: '',
    dob: '',
    bio: '',
    gender: '',
    pronouns: '',
  });
  const dirty =
    !!loaded && (Object.keys(formData) as (keyof ProfileData)[]).some((key) => formData[key] !== loaded[key]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const user = auth.currentUser;
    if (!user) return;
    void getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        if (!active) return;
        const data = snap.data() as Partial<ProfileData> | undefined;
        const initial = {
          displayName: data?.displayName ?? user.displayName ?? '',
          photoURL: data?.photoURL ?? user.photoURL ?? '',
          jobTitle: data?.jobTitle || '',
          dob: data?.dob || '',
          bio: data?.bio || '',
          gender: data?.gender || '',
          pronouns: data?.pronouns || '',
        };
        setFormData(initial);
        setLoaded(initial);
      })
      .catch(() => {
        if (active) {
          setLoaded(null);
          setError('Could not load your profile. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (error && !loading) errorRef.current?.focus();
  }, [error, loading]);
  useEffect(
    () => () => {
      saveAttempt.current += 1;
    },
    [],
  );

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    setSavedAt('');
  };

  const handleSaveChanges = async () => {
    if (!loaded || isSaving) return;
    const invalid: Partial<Record<keyof ProfileData, string>> = {};
    if (!formData.displayName.trim()) invalid.displayName = 'Enter your name.';
    if (formData.photoURL.trim()) {
      try {
        new URL(formData.photoURL.trim());
      } catch {
        invalid.photoURL = 'Enter a valid picture URL.';
      }
    }
    if (formData.dob && formData.dob > today) invalid.dob = 'Choose today or an earlier date.';
    if (formData.bio.length > 500) invalid.bio = 'Use 500 characters or fewer.';
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setError('There is a problem. Check the fields below.');
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    const attempt = ++saveAttempt.current;
    const values = {
      ...formData,
      displayName: formData.displayName.trim(),
      photoURL: formData.photoURL.trim(),
    };
    setIsSaving(true);
    setError(null);
    setSavedAt('');
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        (async () => {
          await updateProfile(user, { displayName: values.displayName, photoURL: values.photoURL });
          await setDoc(doc(db, 'users', user.uid), { ...values, updatedAt: new Date() }, { merge: true });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 15000);
        }),
      ]);
      if (saveAttempt.current !== attempt) return;
      setLoaded(values);
      setFormData(values);
      setSavedAt(`Saved at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      window.dispatchEvent(new Event('ncrp-profile-updated'));
    } catch {
      if (saveAttempt.current === attempt)
        setError('Could not confirm the save. Check your connection and try again.');
    } finally {
      clearTimeout(timer!);
      if (saveAttempt.current === attempt) setIsSaving(false);
    }
  };

  const field = (name: keyof ProfileData, label: string, type = 'text') => (
    <div className="field">
      <label htmlFor={`profile-${name}`}>{label}</label>
      <input
        className="input"
        id={`profile-${name}`}
        name={name}
        type={type}
        required={name === 'displayName'}
        max={name === 'dob' ? today : undefined}
        aria-invalid={!!fieldErrors[name]}
        aria-describedby={fieldErrors[name] ? `profile-${name}-error` : undefined}
        value={formData[name]}
        onChange={handleInputChange}
        autoComplete={name === 'displayName' ? 'name' : undefined}
      />
      {fieldErrors[name] && (
        <p className="err" id={`profile-${name}-error`}>
          {fieldErrors[name]}
        </p>
      )}
    </div>
  );
  return (
    <section className="view on" id="v-profile">
      <div className="page">
        <div className="page-h">
          <p className="sub">Your details and account settings.</p>
        </div>
        {loading ? (
          <p role="status">Loading profile…</p>
        ) : (
          <div className="prof">
            <form
              noValidate
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (!isSaving) void handleSaveChanges();
              }}
            >
              <h2 className="panel-h">Your details</h2>
              <div className="panel-b form">
                <div className="two">
                  {field('displayName', 'Display name')}
                  {field('jobTitle', 'Job title')}
                </div>
                <div className="two">
                  {field('pronouns', 'Pronouns')}
                  <div className="field">
                    <label htmlFor="profile-email">Email</label>
                    <input
                      className="input"
                      id="profile-email"
                      value={auth.currentUser?.email || ''}
                      aria-describedby="profile-email-hint"
                      readOnly
                    />
                    <span className="hint" id="profile-email-hint">
                      Used to sign in. Never shown to members.
                    </span>
                  </div>
                </div>
                <div className="two">
                  {field('dob', 'Date of birth', 'date')}
                  <div className="field">
                    <label htmlFor="profile-gender">Gender</label>
                    <select
                      className="input"
                      id="profile-gender"
                      name="gender"
                      value={formData.gender}
                      onChange={handleInputChange}
                    >
                      <option value="">Select gender</option>
                      {['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {field('photoURL', 'Profile picture URL', 'url')}
                <div className="field">
                  <label htmlFor="profile-bio">About you</label>
                  <textarea
                    className="input"
                    id="profile-bio"
                    name="bio"
                    value={formData.bio}
                    onChange={handleInputChange}
                    rows={4}
                    maxLength={500}
                    aria-invalid={!!fieldErrors.bio}
                    aria-describedby="profile-bio-hint profile-bio-count"
                  />
                  <span className="hint" id="profile-bio-hint">
                    Optional. Only you see this for now.
                  </span>
                  <span className="hint" id="profile-bio-count">
                    {formData.bio.length}/500 characters
                  </span>
                  {fieldErrors.bio && <p className="err">{fieldErrors.bio}</p>}
                </div>
                {error && (
                  <div className="note bad" role="alert" ref={errorRef} tabIndex={-1}>
                    <Icon name="alert" />
                    <div>
                      {error}{' '}
                      {!loaded && (
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => setLoadAttempt((n) => n + 1)}
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="form-foot">
                  <button className="btn primary" disabled={isSaving || !loaded}>
                    {isSaving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={!dirty || isSaving}
                    onClick={() => {
                      if (loaded) setFormData(loaded);
                      setFieldErrors({});
                      setError(null);
                      setSavedAt('');
                    }}
                  >
                    Cancel
                  </button>
                  <span role="status">{savedAt}</span>
                </div>
              </div>
            </form>
            <div className="stack">
              <section className="panel">
                <h2 className="panel-h">Your data</h2>
                <div className="panel-b stack">
                  <p>
                    {shell.count == null
                      ? 'Your connections are saved to your account.'
                      : shell.count === 0
                        ? 'No connections yet.'
                        : `${shell.count.toLocaleString()} connections saved.`}
                  </p>
                  <div>
                    <button
                      className="btn sm"
                      onClick={() => navigate('/recommender', { state: { importConnections: true } })}
                    >
                      <Icon name="upload" />
                      {shell.count === 0 ? 'Import your connections' : 'Import a new export'}
                    </button>
                  </div>
                </div>
              </section>
              <section className="panel">
                <h2 className="panel-h">Network sharing</h2>
                <div className="panel-b stack">
                  <p>
                    {sharing == null ? (
                      'Sharing status unavailable.'
                    ) : sharing ? (
                      <>
                        <b>On.</b> Members see the display name saved when you started sharing and which
                        people you both already have. Saving a new name here does not change it; to show it,
                        stop sharing and share again on Network.
                      </>
                    ) : (
                      <>
                        <b>Off.</b> Nobody sees anything about your network.
                      </>
                    )}
                  </p>
                  <p>Your other connections, messages, notes and email are never shown.</p>
                  <div>
                    <Link className="btn sm ghost" to="/network">
                      Open Network
                    </Link>
                  </div>
                </div>
              </section>
              <section className="panel">
                <h2 className="panel-h">Appearance</h2>
                <div className="panel-b">
                  <fieldset className="actions appearance-options">
                    <legend className="sr-only">Theme</legend>
                    {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                      <label className="check" key={t}>
                        <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />
                        {t[0].toUpperCase() + t.slice(1)}
                      </label>
                    ))}
                  </fieldset>
                </div>
              </section>
              <section className="panel">
                <div className="panel-b">
                  <button className="btn" data-testid="profile-sign-out" onClick={() => void shell.logout()}>
                    <Icon name="out" />
                    Sign out
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
export default ProfileScreen;
