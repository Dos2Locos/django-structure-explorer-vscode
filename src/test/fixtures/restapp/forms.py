from django import forms

from .models import Article


class ArticleForm(forms.ModelForm):
    class Meta:
        model = Article
        fields = ["titulo"]


class ContactForm(forms.Form):
    email = forms.EmailField()


class NoEsForm:
    pass
