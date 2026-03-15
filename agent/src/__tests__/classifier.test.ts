import { AlertClassifier } from '../classifier';
import { makeAlert } from './fixtures';

jest.mock('@actions/core', () => ({ info: jest.fn(), warning: jest.fn() }));

describe('AlertClassifier', () => {
  let classifier: AlertClassifier;

  beforeEach(() => {
    classifier = new AlertClassifier();
  });

  describe('CVSS boundary values (default thresholds)', () => {
    it('classifies 0.0 as low', () => {
      expect(classifier.classify(makeAlert(0.0)).severity).toBe('low');
    });

    it('classifies 3.9 as low (upper boundary)', () => {
      expect(classifier.classify(makeAlert(3.9)).severity).toBe('low');
    });

    it('classifies 4.0 as medium (lower boundary)', () => {
      expect(classifier.classify(makeAlert(4.0)).severity).toBe('medium');
    });

    it('classifies 6.9 as medium (upper boundary)', () => {
      expect(classifier.classify(makeAlert(6.9)).severity).toBe('medium');
    });

    it('classifies 7.0 as high (lower boundary)', () => {
      expect(classifier.classify(makeAlert(7.0)).severity).toBe('high');
    });

    it('classifies 10.0 as high', () => {
      expect(classifier.classify(makeAlert(10.0)).severity).toBe('high');
    });
  });

  describe('custom thresholds', () => {
    it('respects custom low threshold', () => {
      const custom = new AlertClassifier({ low: 2.0, medium: 5.0 });
      expect(custom.classify(makeAlert(2.0)).severity).toBe('low');
      expect(custom.classify(makeAlert(2.1)).severity).toBe('medium');
    });

    it('respects custom medium threshold', () => {
      const custom = new AlertClassifier({ low: 2.0, medium: 5.0 });
      expect(custom.classify(makeAlert(5.0)).severity).toBe('medium');
      expect(custom.classify(makeAlert(5.1)).severity).toBe('high');
    });
  });

  describe('classify()', () => {
    it('sets cvssScore on result', () => {
      const result = classifier.classify(makeAlert(4.5));
      expect(result.cvssScore).toBe(4.5);
    });

    it('passes the original alert through', () => {
      const alert = makeAlert(3.0);
      const result = classifier.classify(alert);
      expect(result.alert).toBe(alert);
    });
  });

  describe('classifyAll()', () => {
    it('classifies a batch of alerts', () => {
      const results = classifier.classifyAll([makeAlert(1.0), makeAlert(5.0), makeAlert(9.0)]);
      expect(results.map((r) => r.severity)).toEqual(['low', 'medium', 'high']);
    });

    it('returns an empty array for empty input', () => {
      expect(classifier.classifyAll([])).toEqual([]);
    });
  });
});
