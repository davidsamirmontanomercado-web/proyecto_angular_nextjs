import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { CategoriasComponent } from './categorias';

describe('CategoriasComponent', () => {
  let component: CategoriasComponent;
  let fixture: ComponentFixture<CategoriasComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoriasComponent],
      providers: [provideHttpClient(), provideRouter([])]
    }).compileComponents();
    fixture = TestBed.createComponent(CategoriasComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});
