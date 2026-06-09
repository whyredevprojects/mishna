import { TestBed } from '@angular/core/testing';
import { MishnaRef } from '../models/api.types';
import { MishnaCardComponent } from './mishna-card.component';
import { MishnaTextService } from '../services/mishna-text.service';

const REF: MishnaRef = { mesechta: 'Berachos', perek: 1, mishna: 1 };

describe('MishnaCardComponent', () => {
  let lookup: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    lookup = vi.fn().mockResolvedValue({
      hebrew: 'עברית',
      english: 'english',
      tractateHebrewName: 'ברכות',
    });
    await TestBed.configureTestingModule({
      imports: [MishnaCardComponent],
      providers: [{ provide: MishnaTextService, useValue: { lookup } }],
    }).compileComponents();
  });

  it('loads text eagerly when not collapsible', async () => {
    const fixture = TestBed.createComponent(MishnaCardComponent);
    fixture.componentRef.setInput('ref', REF);
    fixture.componentRef.setInput('done', false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('defers loading text until expanded in collapsible mode', async () => {
    const fixture = TestBed.createComponent(MishnaCardComponent);
    fixture.componentRef.setInput('ref', REF);
    fixture.componentRef.setInput('done', false);
    fixture.componentRef.setInput('collapsible', true);
    fixture.detectChanges();
    await fixture.whenStable();

    // Collapsed: the heading row renders but no tractate text is fetched.
    expect(fixture.nativeElement.querySelector('.row-head')).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();

    // Clicking the heading expands the card and triggers the (now eager) load.
    fixture.nativeElement.querySelector('.row-head').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
