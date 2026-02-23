import { getSocket } from '../socket';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  pendingCandidates: RTCIceCandidateInit[];
  remoteDescSet: boolean;
}

export class WebRTCManager {
  private peer: Peer | null = null;
  private peerId: string | null = null;
  private peerMap = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  private localVideoStream: MediaStream | null = null;
  private callId: string | null = null;
  private videoEnabled = false;
  private iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;
  private onRemoteStreams: (streams: Map<string, MediaStream>) => void;
  private onEnd: () => void;
  private onParticipantJoined?: (userId: string) => void;
  private onParticipantLeft?: (userId: string) => void;

  constructor(
    onRemoteStreams: (streams: Map<string, MediaStream>) => void,
    onEnd: () => void,
    onParticipantJoined?: (userId: string) => void,
    onParticipantLeft?: (userId: string) => void
  ) {
    this.onRemoteStreams = onRemoteStreams;
    this.onEnd = onEnd;
    this.onParticipantJoined = onParticipantJoined ?? undefined;
    this.onParticipantLeft = onParticipantLeft ?? undefined;
  }

  async loadIceServers(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      const data = await res.json();
      const raw = Array.isArray(data.iceServers) ? data.iceServers : [];
      if (!res.ok || raw.length === 0) throw new Error('No ICE servers');
      const norm = (s: RTCIceServer) => (Array.isArray(s.urls) ? { ...s, urls: s.urls[0] } : s) as RTCIceServer;
      const u = (x: RTCIceServer) => String((x as any).urls || '').toLowerCase();
      const stun = raw.filter((s: RTCIceServer) => u(s).includes('stun')).map(norm).slice(0, 1);
      const turn = raw.filter((s: RTCIceServer) => u(s).includes('turn')).map(norm).slice(0, 2);
      this.iceServers = [...stun, ...turn].slice(0, 4);
    } catch {
      // keep defaults
    }
  }

  private async getOrCreateLocalStream(): Promise<MediaStream | null> {
    if (this.localStream) return this.localStream;
    try {
      const deviceId = localStorage.getItem('audioInputId');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      return this.localStream;
    } catch (e) {
      console.error('getUserMedia failed:', e);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return this.localStream;
      } catch {
        return null;
      }
    }
  }

  private createPC(peerId: string, forGroup: boolean): RTCPeerConnection {
    if (!forGroup) this.closePeer();
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 8,
    });

    pc.onicecandidate = (e) => {
      if (e.candidate && this.callId) {
        getSocket().emit('call:signal', {
          callId: this.callId,
          signal: { candidate: e.candidate },
          targetUserId: peerId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce?.();
      }
      if (pc.iceConnectionState === 'closed') {
        this.removePeer(peerId);
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams?.[0] || new MediaStream([e.track]);
      if (!stream.getTracks().length) return;
      if (this.peerId === peerId && this.peer) {
        this.peer.stream = stream;
      } else if (this.peerMap.has(peerId)) {
        const p = this.peerMap.get(peerId)!;
        p.stream = stream;
      }
      this.notifyRemoteStreams();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') this.removePeer(peerId);
    };

    if (forGroup) {
      this.peerMap.set(peerId, { pc, stream: null, pendingCandidates: [], remoteDescSet: false });
    } else {
      this.peerId = peerId;
      this.peer = { pc, stream: null, pendingCandidates: [], remoteDescSet: false };
    }
    return pc;
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    return this.createPC(peerId, false);
  }

  private createPeerConnectionForGroup(peerId: string): RTCPeerConnection {
    return this.createPC(peerId, true);
  }

  private closePeer() {
    if (this.peer) {
      this.peer.pc.close();
      this.peer = null;
    }
    this.peerId = null;
  }

  private closeAllPeers() {
    this.closePeer();
    this.peerMap.forEach((p) => p.pc.close());
    this.peerMap.clear();
  }

  private removePeer(peerId?: string) {
    const id = peerId ?? this.peerId;
    if (id && this.peerMap.has(id)) {
      this.peerMap.get(id)?.pc.close();
      this.peerMap.delete(id);
    } else {
      this.closePeer();
    }
    if (id) this.onParticipantLeft?.(id);
    this.notifyRemoteStreams();
    if (this.peerMap.size === 0 && !this.peer) this.onEnd();
  }

  private getPeer(peerId: string): Peer | null {
    if (this.peerId === peerId && this.peer) return this.peer;
    return this.peerMap.get(peerId) ?? null;
  }

  private notifyRemoteStreams() {
    const map = new Map<string, MediaStream>();
    if (this.peer?.stream && this.peerId) map.set(this.peerId, this.peer.stream);
    this.peerMap.forEach((p, id) => { if (p.stream) map.set(id, p.stream); });
    this.onRemoteStreams(map);
  }

  private async flushIceCandidatesFor(peer: Peer) {
    if (!peer.remoteDescSet) return;
    for (const c of peer.pendingCandidates) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('addIceCandidate error', e);
      }
    }
    peer.pendingCandidates = [];
  }

  /** Caller: создаёт offer и отправляет после того как callee принял звонок */
  async startCall(callId: string, targetUserId: string): Promise<boolean> {
    this.callId = callId;
    const stream = await this.getOrCreateLocalStream();
    if (!stream) {
      console.error('No microphone');
      return false;
    }

    const pc = this.createPeerConnection(targetUserId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      getSocket().emit('call:signal', {
        callId,
        signal: { offer },
        targetUserId,
      });
      return true;
    } catch (e) {
      console.error('createOffer failed', e);
      this.closePeer();
      return false;
    }
  }

  /** Обработка входящего signal (offer / answer / candidate) */
  async handleSignal(callId: string, signal: any, fromUserId: string): Promise<void> {
    this.callId = callId;

    if (signal.offer) {
      if (this.getPeer(fromUserId)) return;
      const stream = await this.getOrCreateLocalStream();
      if (!stream) {
        console.error('Callee: no microphone');
        return;
      }

      const isGroup = this.peerMap.size > 0;
      const pc = isGroup ? this.createPeerConnectionForGroup(fromUserId) : this.createPeerConnection(fromUserId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const peerObj = this.peer ?? this.peerMap.get(fromUserId);
        if (peerObj) {
          peerObj.remoteDescSet = true;
          await this.flushIceCandidatesFor(peerObj);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket().emit('call:signal', { callId, signal: { answer }, targetUserId: fromUserId });
        this.onParticipantJoined?.(fromUserId);
      } catch (e) {
        console.error('Callee handle offer failed', e);
        if (this.peerId === fromUserId) this.closePeer();
        else {
          this.peerMap.get(fromUserId)?.pc.close();
          this.peerMap.delete(fromUserId);
        }
      }
      return;
    }

    const peerForAnswerOrCandidate = this.getPeer(fromUserId);
    if (signal.answer && peerForAnswerOrCandidate) {
      try {
        await peerForAnswerOrCandidate.pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        peerForAnswerOrCandidate.remoteDescSet = true;
        await this.flushIceCandidatesFor(peerForAnswerOrCandidate);
        this.onParticipantJoined?.(fromUserId);
      } catch (e) {
        console.error('setRemoteDescription answer failed', e);
      }
      return;
    }

    if (signal.candidate && peerForAnswerOrCandidate) {
      if (!peerForAnswerOrCandidate.remoteDescSet) {
        peerForAnswerOrCandidate.pendingCandidates.push(signal.candidate);
      } else {
        try {
          await peerForAnswerOrCandidate.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {
          console.warn('addIceCandidate failed', e);
        }
      }
    }
  }

  /** Групповой звонок: отдельный пир на каждого участника */
  async startCallMultiple(callId: string, participantIds: string[]): Promise<void> {
    this.callId = callId;
    const stream = await this.getOrCreateLocalStream();
    if (!stream) return;
    for (const peerId of participantIds) {
      const pc = this.createPeerConnectionForGroup(peerId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        getSocket().emit('call:signal', { callId, signal: { offer }, targetUserId: peerId });
      } catch (e) {
        console.error('Offer failed for', peerId, e);
      }
    }
  }

  addParticipant(participantId: string): void {
    if (!this.localStream || !this.callId) return;
    if (this.getPeer(participantId)) return;
    const pc = this.createPeerConnectionForGroup(participantId);
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        getSocket().emit('call:signal', { callId: this.callId, signal: { offer: pc.localDescription }, targetUserId: participantId });
      })
      .catch((e) => console.error('addParticipant offer failed', e));
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  async toggleVideo(enabled: boolean): Promise<MediaStream | null> {
    this.videoEnabled = enabled;
    const replaceVideo = (pc: RTCPeerConnection, track: MediaStreamTrack | null) => {
      pc.getSenders().forEach((s) => s.track?.kind === 'video' && s.replaceTrack(track));
    };
    if (enabled) {
      try {
        this.localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track = this.localVideoStream.getVideoTracks()[0];
        this.peer?.pc && replaceVideo(this.peer.pc, track);
        this.peerMap.forEach((p) => replaceVideo(p.pc, track));
        return this.localVideoStream;
      } catch (e) {
        console.error('Video failed', e);
        this.videoEnabled = false;
        return null;
      }
    }
    this.localVideoStream?.getTracks().forEach((t) => t.stop());
    this.localVideoStream = null;
    this.peer?.pc && replaceVideo(this.peer.pc, null);
    this.peerMap.forEach((p) => replaceVideo(p.pc, null));
    return null;
  }

  isVideoEnabled(): boolean {
    return this.videoEnabled;
  }

  getLocalVideoStream(): MediaStream | null {
    return this.localVideoStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  close(): void {
    this.closeAllPeers();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localVideoStream?.getTracks().forEach((t) => t.stop());
    this.localVideoStream = null;
    this.callId = null;
    this.videoEnabled = false;
  }
}
