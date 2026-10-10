import { useEffect, useMemo, useRef, useState } from 'react';
import YouTube from 'react-youtube';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket = io(SERVER_URL, { autoConnect: true });
const videoIdPattern = /^[\w-]{11}$/;

function extractVideoId(value) {
  const input = value.trim();
  if (videoIdPattern.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0];
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
    }
  } catch {}
  return '';
}

export default function App() {
  const [mode, setMode] = useState('welcome');
  const [room, setRoom] = useState(null);
  const [nickname, setNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notice, setNotice] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [player, setPlayer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(75);
  const [showJoin, setShowJoin] = useState(false);
  const searchTimer = useRef(null);

  const isHost = mode === 'host';
  const isRemote = mode === 'remote';
  const currentSong = room?.currentSong || null;
  const queue = room?.queue || [];
  const guestCount = room?.guests?.length || 0;

  useEffect(() => {
    const onUpdate = nextRoom => setRoom(current => current?.code === nextRoom.code ? nextRoom : nextRoom);
    const onClosed = () => {
      setRoom(null); setMode('welcome'); setPlayer(null);
      setNotice('The host closed this karaoke room.');
    };
    socket.on('room:update', onUpdate);
    socket.on('room:closed', onClosed);
    return () => {
      socket.off('room:update', onUpdate);
      socket.off('room:closed', onClosed);
    };
  }, []);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const playerOptions = useMemo(() => ({
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 1, playsinline: 1, rel: 0, origin: window.location.origin }
  }), []);

  function createRoom() {
    socket.emit('room:create', {}, response => {
      if (!response?.ok) return setNotice('Could not create a room. Please try again.');
      setRoom(response.room);
      setMode('host');
      setNotice('Room created. Guests can join using the code or QR link.');
    });
  }

  function joinRoom(event) {
    event?.preventDefault();
    socket.emit('room:join', { code: joinCode, nickname: nickname || 'Guest' }, response => {
      if (!response?.ok) return setNotice(response?.error || 'Could not join room.');
      setRoom(response.room);
      setMode('remote');
      setNotice(`You're in! Welcome, ${response.guest.nickname}.`);
      setShowJoin(false);
    });
  }

  async function searchSongs(event) {
    event?.preventDefault();
    const q = search.trim();
    if (q.length < 2) return;
    setSearching(true); setSearchError(''); setResults([]);
    try {
      const response = await fetch(
  `${SERVER_URL}/api/search?q=${encodeURIComponent(q)}`
);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed.');
      setResults(data.results || []);
      if (data.notice) setNotice(data.notice);
      if (!(data.results || []).length && !data.notice) setSearchError('No videos found. Try another search.');
    } catch (error) {
      setSearchError(error.message || 'Search failed. Check your server and RapidAPI setup.');
    } finally { setSearching(false); }
  }

  function addSong(song) {
    socket.emit('song:add', { song, nickname: nickname || 'Guest' }, response => {
      if (!response?.ok) return setNotice(response?.error || 'Could not add song.');
      setNotice(`Added “${song.title}” to the queue.`);
    });
  }

  function addManualSong(event) {
    event.preventDefault();
    const videoId = extractVideoId(manualUrl);
    if (!videoId) return setNotice('Paste a valid YouTube video link or 11-character video ID.');
    addSong({ videoId, title: 'YouTube video', channel: 'Added by link', thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` });
    setManualUrl('');
  }

  function playNext() {
    socket.emit('host:play-next', {}, response => {
      if (!response?.ok) return setNotice(response?.error || 'Unable to play next song.');
      if (!response.currentSong) {
        player?.stopVideo?.();
        setIsPlaying(false);
        setNotice('Queue is empty. Add a song request from a phone.');
      }
    });
  }

  function removeSong(queueId) {
    socket.emit('host:remove-queue', { queueId });
  }

  function closeRoom() {
    if (!window.confirm('Close this karaoke room for everyone?')) return;
    socket.emit('host:close-room', {}, () => {
      setRoom(null); setMode('welcome'); setPlayer(null);
    });
  }

  function playerReady(event) {
    setPlayer(event.target);
    event.target.setVolume(volume);
    event.target.playVideo();
  }

  function playerStateChange(event) {
    setIsPlaying(event.data === 1);
    if (event.data === 0 && isHost) playNext();
  }

  function togglePlayback() {
    if (!player) return;
    if (isPlaying) player.pauseVideo();
    else player.playVideo();
  }

  function setPlayerVolume(value) {
    setVolume(Number(value));
    player?.setVolume?.(Number(value));
  }

  function copyJoinLink() {
    const link = `${window.location.origin}/?join=${room?.code || ''}`;
    navigator.clipboard?.writeText(link)
      .then(() => setNotice('Join link copied.'))
      .catch(() => setNotice(`Join link: ${link}`));
  }

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('join');
    if (code) { setJoinCode(code); setShowJoin(true); }
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { if (mode === 'welcome') return; setNotice('Your room is still active. Use the room controls to leave safely.'); }}>
          <span className="brand-mark">♫</span><span>vox<span className="brand-accent">karaoke</span></span>
        </button>
        <div className="top-status"><span className="status-dot" /> LIVE SINGING, TOGETHER</div>
        {room && <div className="room-pill"><span>ROOM</span><strong>{room.code}</strong></div>}
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

      {mode === 'welcome' && (
        <main className="welcome page-width">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR ROOM. YOUR SONGS.</div>
            <h1>Pass the mic.<br /><span>Own the night.</span></h1>
            <p className="hero-description">Turn any screen into a karaoke stage. Let everyone search and request songs from their phones while the music keeps playing.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={createRoom}>Create host room <span>↗</span></button>
              <button className="button button-secondary" onClick={() => setShowJoin(true)}>Join with a code</button>
            </div>
            <div className="feature-row">
              <span><i>✓</i> Multiple remotes</span><span><i>✓</i> Shared queue</span><span><i>✓</i> No song interruptions</span>
            </div>
          </div>
          <div className="hero-art">
            <div className="glow glow-one" /><div className="glow glow-two" />
            <div className="music-card">
              <div className="music-card-top"><span className="live-label"><b /> LIVE ROOM</span><span className="equalizer"><i /><i /><i /><i /><i /></span></div>
              <div className="vinyl"><div className="vinyl-center">♫</div></div>
              <div className="music-card-bottom"><span className="mini-label">TONIGHT'S VIBE</span><strong>Sing it your way.</strong><div className="fake-wave">{Array.from({length: 38}, (_, i) => <i key={i} style={{height: `${12 + ((i * 17 + 13) % 43)}px`}} />)}</div></div>
            </div>
            <div className="floating-chip chip-top"><span>♫</span> Queue it from your phone</div>
            <div className="floating-chip chip-bottom"><span className="tiny-avatar">G</span> 4 friends connected <b>●</b></div>
          </div>
          <div className="how-grid">
            <div><span className="step-number">01</span><strong>Create a room</strong><p>Your host screen gets a unique code.</p></div>
            <div><span className="step-number">02</span><strong>Connect your crew</strong><p>Friends join from any phone browser.</p></div>
            <div><span className="step-number">03</span><strong>Keep the songs coming</strong><p>Requests queue up without stopping the music.</p></div>
          </div>
        </main>
      )}

      {showJoin && mode === 'welcome' && (
        <div className="modal-backdrop" onClick={() => setShowJoin(false)}>
          <form className="join-modal" onSubmit={joinRoom} onClick={e => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowJoin(false)}>×</button>
            <span className="modal-icon">♫</span><h2>Join the party</h2><p>Enter the room code shown on the host screen.</p>
            <label>Room code<input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. 482193" maxLength={6} required /></label>
            <label>Your nickname<input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Yhuan" maxLength={24} /></label>
            <button className="button button-primary full-width" type="submit">Join room <span>↗</span></button>
          </form>
        </div>
      )}

      {isHost && room && (
        <main className="dashboard page-width">
          <div className="dashboard-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> HOST CONTROL CENTER</div><h1>Let the good songs <span>roll.</span></h1><p>Your host screen is live. Share the code and let the requests come in.</p></div><button className="button button-danger" onClick={closeRoom}>Close room</button></div>
          <div className="host-grid">
            <section className="panel player-panel">
              <div className="panel-heading"><div><span className="section-kicker">NOW PLAYING</span><h2>{currentSong?.title || 'The stage is yours'}</h2></div><span className="live-badge"><i /> {currentSong ? (isPlaying ? 'PLAYING' : 'READY') : 'STANDBY'}</span></div>
              <div className="player-wrap">
                {currentSong ? <YouTube key={currentSong.videoId} videoId={currentSong.videoId} opts={playerOptions} onReady={playerReady} onStateChange={playerStateChange} onError={() => setNotice('This video may not allow embedding. Remove it from the queue and try another version.')} className="youtube-player" iframeClassName="youtube-frame" /> :
                  <div className="empty-player"><div className="empty-note">♫</div><strong>Your karaoke stage</strong><span>Add a song from a remote, then press Next up.</span><button className="button button-primary" onClick={playNext}>Play next in queue <span>→</span></button></div>}
              </div>
              <div className="player-controls"><button className="control-button" onClick={togglePlayback} disabled={!currentSong || !player}>{isPlaying ? 'Ⅱ Pause' : '▶ Play'}</button><div className="volume-control"><span>♪</span><input type="range" min="0" max="100" value={volume} onChange={e => setPlayerVolume(e.target.value)} aria-label="Volume" /><span>{volume}%</span></div><button className="button button-primary next-button" onClick={playNext}>Next song <span>→</span></button></div>
              <div className="host-hint"><span>✦</span> Guests can search and queue songs without interrupting playback.</div>
            </section>
            <aside className="side-column">
              <section className="panel room-panel"><div className="panel-heading"><div><span className="section-kicker">YOUR ROOM CODE</span><h2 className="room-code">{room.code}</h2></div><button className="icon-button" onClick={() => navigator.clipboard?.writeText(room.code).then(() => setNotice('Room code copied.'))} title="Copy room code">▣</button></div><p>Share this code with your friends so they can request songs.</p><button className="button button-secondary full-width" onClick={copyJoinLink}>Copy invite link</button><div className="guest-summary"><span className="guest-icon">♙</span><span><strong>{guestCount} connected</strong><small>Remote controls</small></span><div className="avatar-stack">{room.guests.slice(0, 4).map((g, i) => <span key={g.id} title={g.nickname} className={`avatar avatar-${i}`}>{g.nickname.charAt(0).toUpperCase()}</span>)}</div></div></section>
              <section className="panel queue-panel"><div className="panel-heading"><div><span className="section-kicker">UP NEXT</span><h2>Song queue <span className="count-badge">{queue.length}</span></h2></div><button className="text-button" onClick={playNext} disabled={!queue.length}>Play next</button></div>{queue.length ? <div className="queue-list">{queue.map((song, index) => <div className="queue-item" key={song.queueId}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><img src={song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/default.jpg`} alt="" /><div className="queue-song"><strong>{song.title}</strong><small>Requested by {song.requestedBy}</small></div><button className="remove-button" onClick={() => removeSong(song.queueId)} title="Remove song">×</button></div>)}</div> : <div className="empty-queue"><span>♫</span><strong>Queue is open</strong><p>Song requests from guests will appear here.</p></div>}</section>
            </aside>
          </div>
        </main>
      )}

      {isRemote && room && (
        <main className="remote-page">
          <div className="remote-header"><div><span className="section-kicker">CONNECTED TO ROOM</span><h1>Pick your <span>next song.</span></h1><p>Room {room.code} · {guestCount} connected</p></div><span className="connection-pill"><i /> CONNECTED</span></div>
          <div className="remote-tabs"><span className="active-tab">Search songs</span><span>Queue ({queue.length})</span></div>
          <form className="search-bar" onSubmit={searchSongs}><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search artist, song, or karaoke version..." /><button className="button button-primary" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>
          <form className="manual-link" onSubmit={addManualSong}><label htmlFor="youtube-link">Or add a YouTube link</label><div><input id="youtube-link" value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="Paste YouTube URL or video ID" /><button className="button button-secondary" type="submit">Add link</button></div></form>
          {searchError && <div className="inline-error">{searchError}</div>}
          {results.length > 0 && <div className="results-heading"><h2>Search results</h2><span>{results.length} videos</span></div>}
          <div className="results-list">{results.map((song, index) => <article className="result-card" key={`${song.videoId}-${index}`}><img src={song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/mqdefault.jpg`} alt="" /><div className="result-info"><strong>{song.title}</strong><span>{song.channel}</span><small>▶ YouTube karaoke</small></div><button className="add-button" onClick={() => addSong(song)} aria-label={`Add ${song.title} to queue`}>＋ <span>Add</span></button></article>)}</div>
          {!results.length && !searching && !searchError && <div className="remote-empty"><div className="remote-note">♫</div><h2>Find your sing-along</h2><p>Search for a song or paste a YouTube link. Your request goes to the queue, not straight to the player.</p></div>}
          <section className="remote-queue panel"><div className="panel-heading"><div><span className="section-kicker">COMING UP</span><h2>Queue <span className="count-badge">{queue.length}</span></h2></div></div>{queue.length ? queue.slice(0, 8).map((song, i) => <div className="queue-item" key={song.queueId}><span className="queue-index">{String(i + 1).padStart(2, '0')}</span><img src={song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/default.jpg`} alt="" /><div className="queue-song"><strong>{song.title}</strong><small>Requested by {song.requestedBy}</small></div></div>) : <p className="queue-empty-text">No songs yet. Be the first to request one!</p>}</section>
          <div className="remote-footer">Made for the group chat that became a karaoke night. <span>♫</span></div>
        </main>
      )}
    </div>
  );
}
