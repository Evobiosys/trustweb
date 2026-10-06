/**
 * Settings > Recording (src/model.ts): which transcription choice is in force
 * (old records keep their "Use TalkWeave on this computer" opt-in), which
 * engines each choice may try (only the TalkWeave choice reaches into this
 * computer; "Transcribe later" probes nothing), and the Record tab's start.
 */
import {
  DefaultRecording, TRANSCRIPTION_CHOICES, TranscriptionChoice, defaultRecording, enginePlan, transcriptionChoice,
} from '../../src/model.ts'

describe('transcriptionChoice', () => {
  it('is Auto for a record that never chose', () => expect(transcriptionChoice({})).toBe(TranscriptionChoice.Auto))
  it('reads the old opt-in as TalkWeave on this computer', () => expect(transcriptionChoice({ talkWeaveLocal: true })).toBe(TranscriptionChoice.TalkWeave))
  it('reads the old switch turned off as Auto', () => expect(transcriptionChoice({ talkWeaveLocal: false })).toBe(TranscriptionChoice.Auto))
  it('lets a made choice win over the old switch', () => {
    expect(transcriptionChoice({ talkWeaveLocal: true, transcription: TranscriptionChoice.Later })).toBe(TranscriptionChoice.Later)
    expect(transcriptionChoice({ talkWeaveLocal: true, transcription: TranscriptionChoice.Auto })).toBe(TranscriptionChoice.Auto)
  })
  it('ignores an unknown stored value', () => expect(transcriptionChoice({ transcription: 'cloud' })).toBe(TranscriptionChoice.Auto))
})

describe('enginePlan', () => {
  it('only the TalkWeave choice probes this computer directly', () => {
    for (const c of TRANSCRIPTION_CHOICES) expect(enginePlan(c).direct).toBe(c === TranscriptionChoice.TalkWeave)
  })
  it('Auto tries the same-origin TalkWeave, then the device', () => expect(enginePlan(TranscriptionChoice.Auto)).toEqual({ sameOrigin: true, direct: false, onDevice: true }))
  it('TalkWeave keeps the old opt-in order', () => expect(enginePlan(TranscriptionChoice.TalkWeave)).toEqual({ sameOrigin: true, direct: true, onDevice: true }))
  it('On this device never asks TalkWeave', () => expect(enginePlan(TranscriptionChoice.OnDevice)).toEqual({ sameOrigin: false, direct: false, onDevice: true }))
  it('Transcribe later tries nothing', () => expect(enginePlan(TranscriptionChoice.Later)).toEqual({ sameOrigin: false, direct: false, onDevice: false }))
})

describe('defaultRecording', () => {
  it('is Just me when absent', () => expect(defaultRecording({})).toBe(DefaultRecording.Solo))
  it('keeps A meeting', () => expect(defaultRecording({ defaultRecording: DefaultRecording.Meeting })).toBe(DefaultRecording.Meeting))
  it('reads anything unknown as Just me', () => expect(defaultRecording({ defaultRecording: 'group' })).toBe(DefaultRecording.Solo))
})
