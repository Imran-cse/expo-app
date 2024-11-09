// Now, let's create the enhanced React Native app (App.js)
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Button,
  StyleSheet,
  Platform,
  SafeAreaView,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
} from "react-native";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  RTCView,
} from "react-native-webrtc";
import io from "socket.io-client";
import { Camera } from "expo-camera";

const configuration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

export default function App() {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const remoteUserId = useRef(null);
  const [userId, setUserId] = useState(
    `user_${Math.floor(Math.random() * 1000)}`
  );
  const [activeUsers, setActiveUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef(null);

  useEffect(() => {
    setupSocket();
    requestPermissions();
    return cleanup;
  }, []);

  const setupSocket = () => {
    // Replace with your server URL
    socket.current = io("http://192.168.0.101:3000");

    socket.current.on("connect", () => {
      console.log("Connected to signaling server");
      socket.current.emit("register", userId);
    });

    socket.current.on("activeUsers", (users) => {
      console.log("Active users:", users);

      setActiveUsers(users.filter((id) => id !== userId));
    });

    socket.current.on("incoming-call", async ({ from, offer }) => {
      Alert.alert("Incoming Call", `${from} is calling you`, [
        {
          text: "Decline",
          onPress: () => {},
          style: "cancel",
        },
        {
          text: "Accept",
          onPress: () => handleIncomingCall(from, offer),
        },
      ]);
    });

    socket.current.on("call-accepted", async (answer) => {
      try {
        await peerConnection.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        setConnectionStatus("connected");
      } catch (err) {
        console.error("Error setting remote description:", err);
      }
    });

    socket.current.on("ice-candidate", async (candidate) => {
      try {
        if (peerConnection.current) {
          await peerConnection.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        }
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    });
  };

  // Update requestPermissions to be more robust
  const requestPermissions = async () => {
    try {
      const { status: cameraStatus } =
        await Camera.requestCameraPermissionsAsync();
      const { status: audioStatus } =
        await Camera.requestMicrophonePermissionsAsync();

      if (cameraStatus !== "granted" || audioStatus !== "granted") {
        Alert.alert(
          "Permission Required",
          "Camera and microphone permissions are required for video calls",
          [{ text: "OK" }]
        );
        return false;
      }

      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          frameRate: 30,
          facingMode: isFrontCamera ? "user" : "environment",
          width: 640,
          height: 480,
        },
      });

      console.log("Accessed media devices:", stream);

      setLocalStream(stream);
      return true;
    } catch (err) {
      console.error("Error accessing media devices:", err);
      Alert.alert("Error", "Could not access camera or microphone");
      return false;
    }
  };

  const setupPeerConnection = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }

    peerConnection.current = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach((track) => {
      peerConnection.current.addTrack(track, localStream);
    });

    peerConnection.current.ontrack = (event) => {
      console.log("Got remote stream:", event.streams[0]);

      setRemoteStream(event.streams[0]);
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit("ice-candidate", {
          to: remoteUserId.current,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.current.oniceconnectionstatechange = () => {
      setConnectionStatus(peerConnection.current.iceConnectionState);
    };

    // Add connection state change handler
    peerConnection.current.onconnectionstatechange = () => {
      switch (peerConnection.current.connectionState) {
        case "disconnected":
        case "failed":
          setConnectionStatus("disconnected");
          cleanup();
          break;
        case "closed":
          setConnectionStatus("closed");
          cleanup();
          break;
      }
    };
  };

  // Add a function to handle call ending
  const endCall = () => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    setRemoteStream(null);
    setConnectionStatus("disconnected");
    remoteUserId.current = null;
  };

  const startCall = async (remoteUserId) => {
    console.log("Calling user:", remoteUserId);

    try {
      if (!localStream) {
        const success = await requestPermissions();
        if (!success) return;
      }

      remoteUserId.current = remoteUserId;
      setupPeerConnection();
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);

      socket.current.emit("call-user", {
        userToCall: remoteUserId,
        offer,
      });
    } catch (err) {
      console.error("Error starting call:", err);
      Alert.alert("Error", "Failed to start call");
    }
  };

  const handleIncomingCall = async (from, offer) => {
    try {
      if (!localStream) {
        await requestPermissions();
      }

      if (!localStream)
        throw new Error("Could not access camera or microphone");

      remoteUserId.current = from;
      setupPeerConnection();
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);

      socket.current.emit("answer-call", {
        to: from,
        answer,
      });
    } catch (err) {
      console.error("Error handling incoming call:", err);
      Alert.alert("Error", "Failed to answer call");
    }
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = async () => {
    setIsFrontCamera(!isFrontCamera);
    if (localStream) {
      const newStream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: !isFrontCamera ? "user" : "environment",
        },
      });
      setLocalStream(newStream);

      // Update tracks in peer connection
      if (peerConnection.current) {
        const senders = peerConnection.current.getSenders();
        const videoSender = senders.find(
          (sender) => sender.track.kind === "video"
        );
        if (videoSender) {
          videoSender.replaceTrack(newStream.getVideoTracks()[0]);
        }
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !isVideoEnabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Update cleanup function
  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.stop();
      });
      setLocalStream(null);
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    if (socket.current) {
      socket.current.disconnect();
    }
    setRemoteStream(null);
    remoteUserId.current = null;
  };

  const renderUserItem = ({ item }) => (
    <TouchableOpacity style={styles.userItem} onPress={() => startCall(item)}>
      <Text style={styles.userItemText}>{item}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.videoContainer}>
        {localStream && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localStream}
            objectFit="cover"
          />
        )}
        {remoteStream && (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteStream}
            objectFit="cover"
          />
        )}
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.controlButton, isMuted && styles.controlButtonActive]}
          onPress={toggleMute}
        >
          <Text style={styles.controlButtonText}>
            {isMuted ? "Unmute" : "Mute"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={toggleCamera}>
          <Text style={styles.controlButtonText}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.controlButton,
            !isVideoEnabled && styles.controlButtonActive,
          ]}
          onPress={toggleVideo}
        >
          <Text style={styles.controlButtonText}>
            {isVideoEnabled ? "Video Off" : "Video On"}
          </Text>
        </TouchableOpacity>

        {remoteStream && (
          <TouchableOpacity
            style={[styles.controlButton, styles.endCallButton]}
            onPress={endCall}
          >
            <Text style={styles.controlButtonText}>End Call</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.usersContainer}>
        <Text style={styles.usersTitle}>Available Users</Text>
        <FlatList
          data={activeUsers}
          renderItem={renderUserItem}
          keyExtractor={(item) => item}
          ListEmptyComponent={
            <Text style={styles.emptyListText}>No users available</Text>
          }
        />
      </View>

      <Text style={styles.statusText}>Status: {connectionStatus}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoContainer: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  localStream: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: "#444",
  },
  remoteStream: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: "#444",
  },
  controlsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    backgroundColor: "#222",
  },
  controlButton: {
    backgroundColor: "#444",
    padding: 10,
    borderRadius: 5,
    width: 100,
    alignItems: "center",
  },
  controlButtonActive: {
    backgroundColor: "#666",
  },
  controlButtonText: {
    color: "white",
  },
  usersContainer: {
    maxHeight: 200,
    padding: 20,
    backgroundColor: "#222",
  },
  usersTitle: {
    color: "white",
    fontSize: 18,
    marginBottom: 10,
  },
  userItem: {
    backgroundColor: "#444",
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
  },
  userItemText: {
    color: "white",
  },
  emptyListText: {
    color: "#666",
    textAlign: "center",
  },
  statusText: {
    color: "white",
    textAlign: "center",
    padding: 10,
    backgroundColor: "#222",
  },
  endCallButton: {
    backgroundColor: "#ff4444",
  },
});
