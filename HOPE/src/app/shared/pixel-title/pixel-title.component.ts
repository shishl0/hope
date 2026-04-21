import { Component } from '@angular/core';

type Glyph = string[];

const GLYPHS: Record<string, Glyph> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

@Component({
  selector: 'app-pixel-title',
  template: `
    <div class="pixel-title" aria-label="Next Gen Web-Tank Combat">
      @for (word of words; track word.text) {
        <span class="pixel-word">
          @for (letter of word.letters; track $index) {
            <span class="pixel-letter" [style.--cols]="letter.cols">
              @for (cell of letter.cells; track $index) {
                <span class="pixel-cell" [class.on]="cell"></span>
              }
            </span>
          }
        </span>
      }
    </div>
  `,
})
export class PixelTitleComponent {
  readonly words = 'NEXT GEN WEB-TANK COMBAT'.split(' ').map((text) => ({
    text,
    letters: Array.from(text).map((letter) => this.buildLetter(letter)),
  }));

  private buildLetter(letter: string): { cols: number; cells: boolean[] } {
    const glyph = GLYPHS[letter.toUpperCase()] || GLYPHS['-'];
    return {
      cols: glyph[0].length,
      cells: glyph.flatMap((row) => Array.from(row).map((cell) => cell === '1')),
    };
  }
}
