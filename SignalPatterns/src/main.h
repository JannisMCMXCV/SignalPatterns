#pragma once

#include <Arduino.h>
#include <driver/dac.h>
#include <vector>

// --------------------------------------
// GPIO-Pins (ESP32)
// --------------------------------------
constexpr uint8_t GPIO_HORN           = 13;

constexpr uint8_t GPIO_SIGNAL_ENABLE  = 34; // HIGH: Enable
constexpr uint8_t GPIO_SIGNAL_SELECT  = 35; // HIGH: DEFAULT; LOW: EMERGENCY

constexpr uint8_t GPIO_HORN_ENABLE    = 12; // LOW: Enable → echtes Horn
constexpr uint8_t GPIO_HONK_EMERGENCY = 14; // LOW: Enable → erzwingt Nutzung des Horns

// --------------------------------------
// Konfiguration
// --------------------------------------
constexpr uint32_t SAMPLE_RATE      = 44100;   // ggf. 32000 für geringere Last
constexpr uint32_t LINEAR_FADE_MS   = 50;      // Dauer des linearen Fade-Ins
constexpr uint32_t EXP_TAU_MS       = 100;     // Zeitkonstante für exp-Fade-In
constexpr uint32_t SAMPLE_INTERVAL_US (1000000 / SAMPLE_RATE);

// --------------------------------------
// Datentypen
// --------------------------------------
enum class WaveForm : uint8_t { WF_SINE=0, WF_SQUARE=1, WF_SAW=2, WF_TRI=3 };
enum class Transition : uint8_t { TR_LINEAR=0, TR_EXP=1, TR_NONE=2 };

struct TrackSegment {
  float      freq;        // Hz
  WaveForm   waveForm;    // siehe WaveForm
  uint16_t   duration;    // ms
  Transition transition;  // siehe Transition
};

// --------------------------------------
// Globale Variablen (nur deklariert, in .cpp definiert)
// --------------------------------------
extern std::array<std::vector<TrackSegment>, 4> tracks;
extern std::array<std::vector<TrackSegment>, 4> synthHorn;
extern std::array<std::vector<TrackSegment>, 4>* activeTracks;

extern volatile bool dacIsPlaying;
extern volatile bool stopDacRequested;

extern hw_timer_t* timer;

extern int       currentSegmentIndices[4];
extern uint32_t  segSamplesLeft[4];
extern uint32_t  segElapsedSamples[4];
extern float     phaseAccumulators[4];
extern float     phaseStep[4];
extern float     gainExp[4];

extern uint32_t  linearFadeSamples;
extern float     invLinearFadeSamples;
extern float     expAlpha;

extern TaskHandle_t dacTaskHandle;

// --------------------------------------
// Funktions-Prototypen
// --------------------------------------
void initTracks();
void playDACLoop();
void stopDACLoop();
void resetDacOutput();
void honk();
void stopHonk();
void stopRealHorn();
void playRealHorn();

void dacTask(void* parameter);
void startDacTask();
void pauseDacTask();
void resumeDacTask();
void killDacTask();

void determineMasterTrack();
std::array<std::vector<TrackSegment>, 4> parseTracksFromJson(const String& jsonTracks);

WaveForm waveformFromString(const char* wf);
Transition transitionFromString(const char* tr);
